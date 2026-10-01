/**
 * Tri déterministe crédit / abonnement (L44, règles validées par Sylvain le
 * 2026-10-01), appliqué à chaque cluster AVANT le LLM :
 *
 *  1. Établissement de la liste partagée (`loans/credit-institutions.ts`)
 *     nommé par TOUS les libellés du cluster → crédit (`classic`, suggestion
 *     de type loan) ou paiement en N fois (`installment`) si un libellé porte
 *     un indicateur de fractionné (4X, 3 FOIS…) ou si l'établissement est une
 *     société BNPL (Klarna, Alma, Pledg). Pas de LLM.
 *  2. Mensuels non listés qui ne sont pas des abonnements (impôts, loyer,
 *     virement à une personne…) : liste d'exclusion → aucune suggestion.
 *  3. Ambigu → LLM : établissement mêlé à d'autres libellés, mot de crédit
 *     (ECHEANCE PRET, MENSUALITE, CREDIT…) ou indicateur de fractionné chez
 *     un créancier non listé, ou série non mensuelle.
 *  4. Toute autre société à série mensuelle → abonnement, nommé d'après le
 *     libellé nettoyé. Pas de LLM.
 *
 * La classification produite passe ensuite par le même validateur que celle
 * du LLM (fraîcheur, 1/mois, gardes créancier existant, anti-re-suggestion).
 */
import {
  CandidateCluster,
  ClusterClassification,
  ClusterOccurrence,
} from '../../models/credit-detection.model';
import {
  BNPL_INSTITUTIONS,
  findCreditInstitution,
  hasCreditWord,
  mentionedInstitutions,
  normalizeLabel,
} from '../loans/credit-institutions';
import { PAY_IN_N_PATTERN } from '../loans/loans-patterns';
import { DetectionValidatorService } from './detection-validator.service';

export type TriageDecision =
  | { route: 'rule'; classification: ClusterClassification }
  | { route: 'excluded'; reason: string }
  | { route: 'llm'; reason: string };

/** Mensuels qui ne sont jamais des abonnements (libellé normalisé, majuscules). */
const EXCLUDED_PAYEES =
  /\b(DGFIP|IMPOTS?|TRESOR PUBLIC|FINANCES PUBLIQUES|AMENDES?|LOYERS?|URSSAF|RETRAIT|DAB)\b/;
/** Virements sortants (vers une personne, l'épargne…) : jamais un abonnement. */
const OUTGOING_TRANSFER = /^(VIR|VIRT|VIREMENT)\b/;
/** Nombre d'échéances lu dans un libellé (« 4X », « 3 FOIS »). */
const INSTALLMENT_COUNT = /\b(\d{1,2}) ?(X|FOIS)\b/;

/** Mots génériques retirés d'un libellé pour nommer un abonnement. */
const NOISE_WORDS = new Set([
  'PRLV',
  'SEPA',
  'PRELEVEMENT',
  'PRELEVT',
  'PRELEV',
  'PRLVT',
  'PAIEMENT',
  'PAIEMT',
  'ACHAT',
  'CB',
  'CARTE',
  'FACTURE',
  'FACT',
  'ECHEANCE',
  'ECH',
  'REF',
  'REFERENCE',
  'MANDAT',
  'RUM',
  'ICS',
  'NUM',
  'NO',
  'DE',
  'DU',
  'DES',
  'EUR',
  'FR',
  'ABONNEMENT',
  'ABO',
  'COTISATION',
  'MENSUEL',
  'MENSUELLE',
  'JANVIER',
  'FEVRIER',
  'MARS',
  'AVRIL',
  'MAI',
  'JUIN',
  'JUILLET',
  'AOUT',
  'SEPTEMBRE',
  'OCTOBRE',
  'NOVEMBRE',
  'DECEMBRE',
]);
const MAX_NAME_WORDS = 3;

const upper = (description: string) =>
  normalizeLabel(description).toUpperCase();

/** Nom d'abonnement tiré d'un libellé bancaire : partie avant « * »,
 *  sans préfixes génériques (PRLV SEPA, PRELEVEMENT…), références ni
 *  dates ; trois mots au plus. null si rien de significatif ne reste. */
export function subscriptionNameFromLabel(description: string): string | null {
  const head = description.split('*')[0];
  const words = upper(head)
    .split(' ')
    .filter((w) => w.length > 1 && !/\d/.test(w) && !NOISE_WORDS.has(w));
  return words.length > 0 ? words.slice(0, MAX_NAME_WORDS).join(' ') : null;
}

function mostFrequent(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/** Série mensuelle : au plus un débit par mois, ≥ 2 mois distincts et
 *  espacement mensuel — sur une sous-série de montant (±5 %) ou, à défaut
 *  (montant variable), sur tout le cluster. */
function isMonthlySeries(occurrences: ClusterOccurrence[]): boolean {
  const byDate = [...occurrences].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
  const candidates = [
    ...DetectionValidatorService.splitByAmount(occurrences).filter(
      (s) => s.length >= 2,
    ),
    byDate,
  ];
  return candidates.some((series) => {
    const months = new Set(series.map((o) => o.date.slice(0, 7)));
    return (
      months.size >= 2 &&
      months.size === series.length &&
      DetectionValidatorService.checkIntervals(series)
    );
  });
}

function ruleClassification(
  cluster: CandidateCluster,
  classification: ClusterClassification['classification'],
  creditor: string,
  installmentCount: number | null,
  rationale: string,
): TriageDecision {
  return {
    route: 'rule',
    classification: {
      classification,
      creditor,
      merchant: cluster.merchant,
      installmentCount,
      confidence: 1,
      rationale: `Règle déterministe : ${rationale}`,
    },
  };
}

export function triageCluster(cluster: CandidateCluster): TriageDecision {
  const descriptions = cluster.occurrences.map((o) => o.description);

  // 1. Établissement de la liste.
  const institutions = new Set(
    descriptions.map(findCreditInstitution).filter((n): n is string => !!n),
  );
  if (institutions.size > 1) {
    return { route: 'llm', reason: 'plusieurs établissements dans le cluster' };
  }
  if (institutions.size === 1) {
    const [institution] = [...institutions];
    const namedEverywhere = descriptions.every((d) =>
      mentionedInstitutions(d).includes(institution),
    );
    if (!namedEverywhere) {
      return {
        route: 'llm',
        reason: `${institution} mêlé à d'autres libellés`,
      };
    }
    const payInN = descriptions.some((d) => PAY_IN_N_PATTERN.test(d));
    const creditor = institution.toUpperCase();
    if (payInN || BNPL_INSTITUTIONS.has(institution)) {
      const counts = descriptions
        .map((d) => INSTALLMENT_COUNT.exec(upper(d)))
        .filter((m): m is RegExpExecArray => !!m)
        .map((m) => m[1]);
      const count = mostFrequent(counts);
      return ruleClassification(
        cluster,
        'installment',
        creditor,
        count ? Number(count) : null,
        payInN
          ? `établissement de crédit listé (${institution}), indicateur de fractionné dans le libellé`
          : `société de paiement fractionné (${institution})`,
      );
    }
    return ruleClassification(
      cluster,
      'classic',
      creditor,
      null,
      `établissement de crédit listé (${institution})`,
    );
  }

  // 2. Mensuels qui ne sont pas des abonnements.
  const excluded = descriptions.map((d) => {
    const label = upper(d);
    return EXCLUDED_PAYEES.test(label) || OUTGOING_TRANSFER.test(label);
  });
  if (excluded.every(Boolean)) {
    return { route: 'excluded', reason: 'non_subscription_payee' };
  }
  if (excluded.some(Boolean)) {
    return { route: 'llm', reason: 'cluster partiellement exclu' };
  }

  // 3. Ambigus.
  if (descriptions.some(hasCreditWord)) {
    return {
      route: 'llm',
      reason: 'mot de crédit chez un créancier non listé',
    };
  }
  if (descriptions.some((d) => PAY_IN_N_PATTERN.test(d))) {
    return { route: 'llm', reason: 'fractionné chez un créancier non listé' };
  }
  if (!isMonthlySeries(cluster.occurrences)) {
    return { route: 'llm', reason: 'série non mensuelle' };
  }

  // 4. Abonnement.
  const name =
    mostFrequent(
      descriptions
        .map(subscriptionNameFromLabel)
        .filter((n): n is string => !!n),
    ) ?? cluster.creditor.toUpperCase();
  return ruleClassification(
    cluster,
    'subscription',
    name,
    null,
    'société non listée comme établissement de crédit, débit mensuel récurrent',
  );
}
