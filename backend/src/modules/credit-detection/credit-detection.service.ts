import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { CandidateClusteringService } from './candidate-clustering.service';
import { CreditClassifierService } from './credit-classifier.service';
import { DetectionValidatorService } from './detection-validator.service';
import { StorageService } from '../storage/storage.service';
import { LoansService } from '../loans/loans.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CandidateCluster, DetectionScanResult } from '../../models/credit-detection.model';
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
    return this.runScan(clusters);
  }

  async scanStatement(statement: MonthlyStatement): Promise<DetectionScanResult> {
    const clusters = await this.buildClustersFor([statement]);
    return this.runScan(clusters);
  }

  private async buildClustersFor(statements: MonthlyStatement[]): Promise<CandidateCluster[]> {
    const [loans, subscriptions] = await Promise.all([
      this.loansService.getAll(),
      this.subscriptionsService.getAll(),
    ]);
    const excludedTxIds = CandidateClusteringService.collectKnownTxIds(loans, subscriptions);
    return this.clustering.buildClusters(statements, excludedTxIds);
  }

  private async runScan(clusters: CandidateCluster[]): Promise<DetectionScanResult> {
    const errors: { clusterKey: string; message: string }[] = [];
    let suggestionsCreated = 0;
    let networkErrors = 0;

    for (const cluster of clusters) {
      let classification;
      try {
        classification = await this.classifier.classify(cluster);
      } catch (err) {
        const e = err as Error;
        errors.push({ clusterKey: cluster.key, message: e?.message ?? 'Erreur inconnue' });
        if (e instanceof TypeError) networkErrors++;
        this.logger.warn(`classify échoué pour cluster ${cluster.key}: ${e?.message ?? err}`);
        continue;
      }

      const validation = await this.validator.validate(cluster, classification);
      if (validation.created) suggestionsCreated++;
    }

    if (clusters.length > 0 && errors.length === clusters.length && networkErrors === clusters.length) {
      throw new BadGatewayException(
        `Ollama indisponible : ${errors[0]?.message ?? 'erreur réseau'}`,
      );
    }

    return { clustersAnalyzed: clusters.length, suggestionsCreated, errors };
  }
}
