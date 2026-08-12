import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { CandidateClusteringService } from './candidate-clustering.service';
import { CreditClassifierService } from './credit-classifier.service';
import { DetectionValidatorService } from './detection-validator.service';
import { StorageService } from '../storage/storage.service';
import { LoansService } from '../loans/loans.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import {
  CandidateCluster,
  DetectionScanResult,
} from '../../models/credit-detection.model';
import { MonthlyStatement } from '../../models/monthly-statement.model';

/**
 * Orchestrateur du pipeline de détection crédits/abonnements LLM :
 * clustering (déterministe) -> classify (Ollama local) -> validate (règles chiffrées).
 * Aucune exception réseau isolée ne doit faire échouer tout le scan — sauf
 * si TOUS les clusters échouent pour cause réseau (Ollama down), auquel cas
 * on fail-loud avec un 502 explicite plutôt que de renvoyer un résultat vide.
 */
@Injectable()
export class CreditDetectionService {
  private readonly logger = new Logger(CreditDetectionService.name);

  constructor(
    private readonly clustering: CandidateClusteringService,
    private readonly classifier: CreditClassifierService,
    private readonly validator: DetectionValidatorService,
    private readonly storage: StorageService,
    private readonly loansService: LoansService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async scanAll(): Promise<DetectionScanResult> {
    const statements = await this.storage.getAllStatements();
    const clusters = await this.buildClustersFor(statements);
    const latestStatementDate =
      CreditDetectionService.computeLatestTransactionDate(statements);
    return this.runScan(clusters, latestStatementDate);
  }

  /**
   * Round 4 fix I-3 : clusteriser uniquement sur `[statement]` rendait ce
   * hook post-import structurellement inutile — un plan mensuel classique
   * (1 occurrence par relevé) n'atteint jamais MIN_OCCURRENCES=2 du
   * clustering si on ne regarde que le relevé du jour. On clusterise donc
   * sur `getAllStatements()` (comme `scanAll`) pour que l'historique
   * complet forme les clusters, puis on filtre pour ne garder QUE les
   * clusters ayant au moins une occurrence sur le relevé fraîchement
   * importé — pas de re-scan LLM inutile de clusters purement anciens déjà
   * couverts par un `scanAll` précédent.
   */
  async scanStatement(
    statement: MonthlyStatement,
  ): Promise<DetectionScanResult> {
    const allStatements = await this.storage.getAllStatements();
    const clusters = await this.buildClustersFor(allStatements);
    const touchedClusters = clusters.filter((c) =>
      c.occurrences.some((o) => o.statementId === statement.id),
    );
    const latestStatementDate =
      CreditDetectionService.computeLatestTransactionDate(allStatements);
    return this.runScan(touchedClusters, latestStatementDate);
  }

  /**
   * Round 5 fix 3 : calculée une seule fois par scan (pas par cluster) —
   * max des `t.date` de toutes les transactions de tous les relevés
   * considérés. Sert de référence pour la garde de fraîcheur du
   * validateur (`series_ended`). Fallback sur la date du jour si aucune
   * transaction (statements vides) pour ne jamais planter le scan.
   */
  private static computeLatestTransactionDate(
    statements: MonthlyStatement[],
  ): string {
    let max: string | null = null;
    for (const statement of statements) {
      for (const t of statement.transactions) {
        if (!max || t.date > max) max = t.date;
      }
    }
    return max ?? new Date().toISOString().slice(0, 10);
  }

  private async buildClustersFor(
    statements: MonthlyStatement[],
  ): Promise<CandidateCluster[]> {
    const [loans, subscriptions] = await Promise.all([
      this.loansService.getAll(),
      this.subscriptionsService.getAll(),
    ]);
    const excludedTxIds = CandidateClusteringService.collectKnownTxIds(
      loans,
      subscriptions,
    );
    return this.clustering.buildClusters(statements, excludedTxIds);
  }

  private async runScan(
    clusters: CandidateCluster[],
    latestStatementDate: string,
  ): Promise<DetectionScanResult> {
    const errors: { clusterKey: string; message: string }[] = [];
    let suggestionsCreated = 0;
    let networkErrors = 0;

    for (const cluster of clusters) {
      let classification;
      try {
        classification = await this.classifier.classify(cluster);
      } catch (err) {
        const e = err as Error;
        errors.push({
          clusterKey: cluster.key,
          message: e?.message ?? 'Erreur inconnue',
        });
        if (e instanceof TypeError) networkErrors++;
        this.logger.warn(
          `classify échoué pour cluster ${cluster.key}: ${e?.message ?? err}`,
        );
        continue;
      }

      try {
        const validation = await this.validator.validate(
          cluster,
          classification,
          latestStatementDate,
        );
        if (validation.created) {
          suggestionsCreated += validation.createdCount ?? 1;
        }
      } catch (err) {
        const e = err as Error;
        errors.push({
          clusterKey: cluster.key,
          message: `validate échoué : ${e?.message ?? 'Erreur inconnue'}`,
        });
        this.logger.warn(
          `validate échoué pour cluster ${cluster.key}: ${e?.message ?? err}`,
        );
      }
    }

    if (
      clusters.length > 0 &&
      errors.length === clusters.length &&
      networkErrors === clusters.length
    ) {
      throw new BadGatewayException(
        `Ollama indisponible : ${errors[0]?.message ?? 'erreur réseau'}`,
      );
    }

    return { clustersAnalyzed: clusters.length, suggestionsCreated, errors };
  }
}
