/**
 * EXCEPTION PRIVACY (documentée, à ne jamais étendre sans revalider) :
 * ce service envoie les LIBELLÉS bruts des transactions groupées en cluster
 * (ex. "Klarni*Zoland 4X 1/3") au LLM, contrairement à `HealthAdviceService`
 * qui n'envoie que des agrégats. C'est acceptable UNIQUEMENT parce que
 * `ollamaAdviceBaseUrl` pointe vers une instance Ollama LOCALE
 * (localhost / LAN maison). Ne JAMAIS reconfigurer ce service — ni son
 * `ollamaDetectionModel` — vers un endpoint distant ou un provider cloud.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CandidateCluster,
  ClusterClassification,
  DetectionClass,
} from '../../models/credit-detection.model';

const OLLAMA_TIMEOUT_MS = 60_000;

const DETECTION_CLASSES: DetectionClass[] = [
  'installment',
  'revolving',
  'classic',
  'subscription',
  'not_credit',
];

@Injectable()
export class CreditClassifierService {
  private readonly logger = new Logger(CreditClassifierService.name);

  constructor(private readonly config: ConfigService) {}

  async classify(cluster: CandidateCluster): Promise<ClusterClassification> {
    const baseUrl =
      this.config.get<string>('ollamaAdviceBaseUrl') ??
      'http://localhost:11434';
    const model =
      this.config.get<string>('ollamaDetectionModel') ?? 'qwen3:32b';

    const prompt = this.buildPrompt(cluster);

    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        prompt,
      }),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}`);
    }

    const payload = (await response.json()) as { response?: string };
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload.response ?? '');
    } catch {
      throw new Error('Réponse Ollama invalide: JSON illisible');
    }

    return this.validateClassification(parsed);
  }

  private buildSystemPrompt(): string {
    return (
      'Tu es un analyste de relevés bancaires français. On te donne une série de débits regroupés ' +
      'par contrepartie (libellés, montants, dates). Classe la série :\n' +
      '- `installment` = paiement en plusieurs fois (série courte de montants quasi identiques, ~mensuels, ' +
      'créancier BNPL type Klarna/Alma/PayPal/Oney/Floa)\n' +
      "- `revolving` = mensualité d'une réserve renouvelable\n" +
      "- `classic` = mensualité fixe d'un crédit amortissable\n" +
      '- `subscription` = abonnement récurrent long à montant fixe\n' +
      '- `not_credit` = achats ponctuels sans lien de crédit\n\n' +
      '`loan` (classic/revolving) est RÉSERVÉ aux organismes de crédit et banques de financement ' +
      '(Cofidis, Sofinco/CA Consumer Finance, Cetelem, Cofinoga, Franfinance, Younited…). Ce ne sont ' +
      'JAMAIS des factures de fournisseurs. Exemples de catégories génériques publiques à classer ' +
      'ailleurs (ce ne sont pas des données privées, seulement des repères de catégorie) :\n' +
      '- Énergie/eau/télécom (EDF, Engie, opérateurs télécom) → `subscription` si récurrent à montant ' +
      'fixe, sinon `not_credit`\n' +
      '- Impôts et administrations (DGFIP, trésor public, amendes) → `not_credit`\n' +
      '- Transports (SNCF, Navigo) → `subscription` si récurrent à montant fixe, sinon `not_credit`\n' +
      '- Streaming/presse (Canal+, Netflix…) et commerces → `subscription` si récurrent à montant fixe, ' +
      'sinon `not_credit`\n\n' +
      'Un cluster peut contenir PLUSIEURS plans de paiement N× entremêlés (montants différents, même ' +
      'créancier/marchand) — si la série ressemble à des paiements échelonnés BNPL malgré des montants ' +
      'hétérogènes, classe `installment` quand même : le découpage par montant en sous-séries est fait en ' +
      'aval, pas à ta charge.\n\n' +
      'Si les libellés semblent mélanger plusieurs séries distinctes (montants incohérents, marchands ' +
      'différents), réponds not_credit avec une confidence basse et explique dans rationale : le cluster ' +
      'peut fusionner deux marchands distincts du même créancier.\n\n' +
      "N'invente aucun chiffre. Réponds UNIQUEMENT en JSON, avec cette forme exacte : " +
      '{"classification":"...","creditor":"...","merchant":"...ou null","installmentCount":N ou null,' +
      '"confidence":0.0-1.0,"rationale":"..."}'
    );
  }

  private buildPrompt(cluster: CandidateCluster): string {
    const context = {
      creditor: cluster.creditor,
      merchant: cluster.merchant,
      occurrences: cluster.occurrences.map((o) => ({
        date: o.date,
        amount: o.amount,
        description: o.description,
      })),
    };
    return (
      this.buildSystemPrompt() +
      '\n\nVoici la série à classer :\n\n' +
      JSON.stringify(context, null, 2) +
      '\n\nRéponds uniquement avec le JSON demandé.'
    );
  }

  private validateClassification(raw: unknown): ClusterClassification {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error('Réponse Ollama invalide: objet attendu');
    }
    const r = raw as Record<string, unknown>;

    if (
      typeof r.classification !== 'string' ||
      !DETECTION_CLASSES.includes(r.classification as DetectionClass)
    ) {
      throw new Error(
        `Réponse Ollama invalide: classification "${String(r.classification)}" hors enum`,
      );
    }

    if (typeof r.creditor !== 'string' || !r.creditor.trim()) {
      throw new Error('Réponse Ollama invalide: creditor manquant');
    }

    if (r.merchant !== null && typeof r.merchant !== 'string') {
      throw new Error(
        'Réponse Ollama invalide: merchant doit être string ou null',
      );
    }

    if (
      typeof r.confidence !== 'number' ||
      Number.isNaN(r.confidence) ||
      r.confidence < 0 ||
      r.confidence > 1
    ) {
      throw new Error('Réponse Ollama invalide: confidence hors bornes 0-1');
    }

    if (
      r.installmentCount !== null &&
      (typeof r.installmentCount !== 'number' ||
        !Number.isInteger(r.installmentCount) ||
        r.installmentCount < 2 ||
        r.installmentCount > 24)
    ) {
      throw new Error(
        'Réponse Ollama invalide: installmentCount doit être null ou un entier 2-24',
      );
    }

    if (typeof r.rationale !== 'string' || !r.rationale.trim()) {
      throw new Error('Réponse Ollama invalide: rationale manquant');
    }

    return {
      classification: r.classification as DetectionClass,
      creditor: r.creditor,
      merchant: r.merchant ?? null,
      installmentCount: r.installmentCount ?? null,
      confidence: r.confidence,
      rationale: r.rationale,
    };
  }
}
