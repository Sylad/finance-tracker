import { Injectable, Logger } from '@nestjs/common';
import {
  CandidateCluster,
  ClusterClassification,
  ClusterOccurrence,
} from '../../models/credit-detection.model';
import { LoansService } from '../loans/loans.service';
import { LoanSuggestionsService } from '../loan-suggestions/loan-suggestions.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import {
  IncomingSuggestion,
  SuggestionEvidence,
} from '../../models/loan-suggestion.model';
import { escapeRegex } from '../../common/regex.util';

const MIN_CONFIDENCE = 0.6;
const AMOUNT_TOLERANCE = 0.05;
const INTERVAL_MULTI_MIN_DAYS = 25;
const INTERVAL_MULTI_MAX_DAYS = 35;
const INTERVAL_SINGLE_MIN_DAYS = 20;
const INTERVAL_SINGLE_MAX_DAYS = 40;
/** Round 5 fix 3 : au-delà de ce nombre de jours entre la dernière
 *  occurrence d'un cluster et la date la plus récente observée sur tous
 *  les relevés, la série est considérée terminée — pas de suggestion. */
const SERIES_ENDED_MAX_DAYS = 60;
/** Round 5 fix 1 : nombre max d'occurrences persistées dans `evidence`. */
const MAX_EVIDENCE_OCCURRENCES = 12;
/** Round 3 fix 1 : une sous-série installment avec ≥6 occurrences (donc
 *  ≥6 mois calendaires distincts, déjà garanti par le check mensuel) à
 *  montant stable (garanti par splitByAmount) n'est pas un paiement en N
 *  fois — c'est un abonnement récurrent que le LLM a mal classé
 *  `installment` (ex. Prime Video 1.99/mois). */
const LONG_SERIES_SUBSCRIPTION_MIN_OCCURRENCES = 6;
/** Round 6 fix : nombre minimum de mois calendaires distincts pour que la
 *  branche standard-loan (revolving/classic) affirme une récurrence
 *  mensuelle suffisante pour un crédit — cf CLAUDE.md invariant "1 débit/
 *  mois max par crédit" (APEX 06). En dessous, pas assez de signal. */
const MIN_LOAN_DISTINCT_MONTHS = 3;
/** Round 6 fix : un crédit se débite le même jour du mois (± quelques
 *  jours pour les décalages week-ends/fériés) — au-delà de cet écart
 *  (distance circulaire, gère la fin de mois) par rapport à la médiane
 *  des jours-du-mois observés, la série n'a pas le profil d'un crédit. */
const MAX_DAY_OF_MONTH_DRIFT = 5;
/** Round 8 fix 1 : découpages N× français usuels — un installmentCount
 *  hors de cette liste est jugé fabriqué par le LLM (cas réel : "8×" puis
 *  "6×" inventés pour des plans Klarna qui étaient en réalité des 3×,
 *  vérité confirmée par l'utilisateur sur Zalando). */
const ALLOWED_INSTALLMENT_COUNTS = new Set([2, 3, 4, 5, 6, 10, 12]);
/** Round 8 fix 1 : marge de projection au-delà des occurrences déjà
 *  observées — au-delà, pas de preuve qu'il y ait vraiment ce nombre
 *  d'échéances futures, l'installmentCount est jugé halluciné. */
const INSTALLMENT_COUNT_PROJECTION_MARGIN = 2;
/** Backlog revue 2026-08-13 #3 : une suggestion `subscription` exige au
 *  moins 2 mois calendaires distincts (2 débits à 4 jours d'écart dans le
 *  même mois ne sont pas un abonnement). */
const MIN_SUBSCRIPTION_DISTINCT_MONTHS = 2;
/** `cluster.creditor` est le premier mot du libellé nettoyé
 *  (`parseCounterpart`), pas un nom de créancier : en dessous de cette
 *  longueur (« ca », « la », « lbp »…), il ne matche un créancier connu
 *  que par égalité stricte du nom entier. */
const MIN_CLUSTER_TOKEN_WORD_LENGTH = 4;
/** Premiers mots de libellé génériques, jamais significatifs comme
 *  créancier : ignorés par les gardes « créancier existant ». */
const GENERIC_CLUSTER_TOKENS = new Set([
  'permanent',
  'commission',
  'pour',
  'prlv',
  'sepa',
  'carte',
  'frais',
  'retrait',
  'remise',
  'echeance',
  'échéance',
  'facture',
  'cotisation',
  'abonnement',
  'mensualite',
  'mensualité',
  'remboursement',
  'pret',
  'prêt',
  'credit',
  'crédit',
]);

/** Noms candidats d'un cluster pour les gardes « créancier existant » :
 *  le nom LLM (comparé en containment fuzzy) et le jeton déterministe
 *  `cluster.creditor` (comparé par mot entier, cf `tokenCreditorMatch`). */
interface CreditorNames {
  llm: string | null;
  clusterToken: string | null;
}

export interface ValidationResult {
  created: boolean;
  /** Nombre de suggestions effectivement créées (branche installment
   *  multi-sous-séries). Absent quand non pertinent (0 ou 1 implicite). */
  createdCount?: number;
  reason?: string;
}

/**
 * Validateur déterministe des clusters classifiés par CreditClassifierService.
 * Aucun appel LLM ici — que des règles chiffrées (spec §3) qui protègent
 * contre les faux positifs installment avant de matérialiser une suggestion.
 */
@Injectable()
export class DetectionValidatorService {
  private readonly logger = new Logger(DetectionValidatorService.name);

  constructor(
    private readonly loansService: LoansService,
    private readonly loanSuggestionsService: LoanSuggestionsService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async validate(
    cluster: CandidateCluster,
    classification: ClusterClassification,
    latestStatementDate: string,
  ): Promise<ValidationResult> {
    if (classification.confidence < MIN_CONFIDENCE) {
      return { created: false, reason: 'low_confidence' };
    }

    // Round 5 fix 3 : garde de fraîcheur, AVANT la classification par type —
    // une série dont la dernière occurrence est trop ancienne par rapport
    // au relevé le plus récent est terminée, peu importe sa classification.
    const lastOccurrenceDate = DetectionValidatorService.maxDate(
      cluster.occurrences.map((o) => o.date),
    );
    if (
      DetectionValidatorService.daysBetween(
        lastOccurrenceDate,
        latestStatementDate,
      ) > SERIES_ENDED_MAX_DAYS
    ) {
      return { created: false, reason: 'series_ended' };
    }

    switch (classification.classification) {
      case 'not_credit':
        return { created: false, reason: 'not_credit' };
      case 'installment':
        return this.validateInstallment(
          cluster,
          classification,
          latestStatementDate,
        );
      case 'subscription':
        return this.validateSubscription(
          cluster,
          classification,
          latestStatementDate,
        );
      case 'revolving':
      case 'classic':
        return this.validateStandardLoan(cluster, classification);
      default:
        return { created: false, reason: 'unknown_classification' };
    }
  }

  /**
   * Un cluster creditor|merchant peut contenir plusieurs plans N× joués en
   * parallèle (montants différents, ex. Klarna qui enchaîne 3 achats
   * distincts chez le même marchand). On découpe donc d'abord en
   * sous-séries par montant (clustering glouton ±5%, cf. `splitByAmount`
   * de LoansService) puis chaque sous-série ≥2 occurrences est validée
   * indépendamment et produit sa propre suggestion. Une sous-série isolée
   * (1 occurrence) est silencieusement ignorée sans invalider les autres.
   *
   * Round 7 fix 1 : le garde de fraîcheur cluster-niveau de `validate()`
   * ne teste que la date max de TOUT le cluster — un cluster creditor
   * (ex. 'carrefour') dont une sous-série est vivante laissait passer ses
   * sous-séries mortes (montant différent, plus revu depuis des mois).
   * `latestStatementDate` est donc propagé jusqu'à
   * `validateInstallmentSubSeries` qui applique le même garde par
   * sous-série — une sous-série morte est rejetée `series_ended` sans
   * invalider les autres (même logique que les autres rejets ici : la
   * boucle continue, `lastReason` est mis à jour).
   */
  private async validateInstallment(
    cluster: CandidateCluster,
    classification: ClusterClassification,
    latestStatementDate: string,
  ): Promise<ValidationResult> {
    const subSeries = DetectionValidatorService.splitByAmount(
      cluster.occurrences,
    ).filter((occurrences) => occurrences.length >= 2);

    if (subSeries.length === 0) {
      return { created: false, reason: 'installment_no_recurring_amount' };
    }

    const disambiguate = subSeries.length > 1;
    const creditorNames = DetectionValidatorService.creditorNames(
      cluster,
      classification,
    );
    let createdCount = 0;
    let lastReason: string | undefined;

    for (const occurrences of subSeries) {
      const result = await this.validateInstallmentSubSeries(
        occurrences,
        classification,
        creditorNames,
        disambiguate,
        latestStatementDate,
      );
      if (result.created) {
        createdCount++;
      } else {
        lastReason = result.reason;
      }
    }

    if (createdCount === 0) {
      return {
        created: false,
        reason: lastReason ?? 'installment_no_recurring_amount',
      };
    }
    return { created: true, createdCount };
  }

  private async validateInstallmentSubSeries(
    occurrences: ClusterOccurrence[],
    classification: ClusterClassification,
    creditorNames: CreditorNames,
    disambiguate: boolean,
    latestStatementDate: string,
  ): Promise<ValidationResult> {
    // Round 7 fix 1 : garde de fraîcheur PAR sous-série (le check
    // cluster-niveau de `validate()` reste en early-exit économe, mais ne
    // suffit pas dès qu'une sous-série vivante masque des sous-séries
    // mortes du même cluster).
    const subSeriesLastDate = DetectionValidatorService.maxDate(
      occurrences.map((o) => o.date),
    );
    if (
      DetectionValidatorService.daysBetween(
        subSeriesLastDate,
        latestStatementDate,
      ) > SERIES_ENDED_MAX_DAYS
    ) {
      return { created: false, reason: 'series_ended' };
    }

    const months = occurrences.map((o) => o.date.slice(0, 7));
    if (new Set(months).size !== months.length) {
      return { created: false, reason: 'installment_multiple_per_month' };
    }

    const intervalCheck = DetectionValidatorService.checkIntervals(occurrences);
    if (!intervalCheck) {
      return { created: false, reason: 'installment_interval_out_of_range' };
    }

    const amountsAbs = occurrences.map((o) => Math.abs(o.amount));
    const medianAmount = DetectionValidatorService.round2(
      DetectionValidatorService.median(amountsAbs),
    );

    // Round 3 fix 2 : vérifié AVANT toute autre décision (reroute
    // subscription incluse) — si c'est un crédit déjà suivi, on ne veut
    // jamais le re-suggérer, peu importe sous quelle forme.
    if (await this.hasFuzzyKnownLoanPayment(creditorNames, medianAmount)) {
      return { created: false, reason: 'existing_loan_payment' };
    }

    // Round 3 fix 1 — reroute AVANT le check installmentCount : le
    // installmentCount du LLM n'est pas pertinent pour juger une série
    // qu'il a de toute façon mal classée.
    if (occurrences.length >= LONG_SERIES_SUBSCRIPTION_MIN_OCCURRENCES) {
      return this.createSubscriptionFromSeries(
        occurrences,
        classification,
        creditorNames,
        medianAmount,
        disambiguate,
      );
    }

    if (await this.hasDismissedSuggestion(creditorNames, medianAmount)) {
      return { created: false, reason: 'loan_already_dismissed' };
    }

    // Round 8 fix 1 : normalise l'installmentCount AVANT tout usage —
    // signal non fiable, jamais de chiffre fabriqué dans la suggestion.
    const normalizedInstallmentCount =
      DetectionValidatorService.normalizeInstallmentCount(
        classification.installmentCount,
        occurrences.length,
      );

    if (
      normalizedInstallmentCount != null &&
      occurrences.length > normalizedInstallmentCount
    ) {
      return { created: false, reason: 'installment_count_exceeded' };
    }

    if (
      await this.hasExistingLoanMatch(
        creditorNames,
        medianAmount,
        occurrences[occurrences.length - 1].description,
      )
    ) {
      return { created: false, reason: 'existing_loan_match' };
    }

    const count = normalizedInstallmentCount ?? occurrences.length;
    const base = DetectionValidatorService.buildLabel(
      classification,
      `${count}×`,
    );
    const label = disambiguate ? `${base} (${medianAmount}€)` : base;

    const incoming: IncomingSuggestion = {
      label,
      monthlyAmount: medianAmount,
      occurrencesSeen: occurrences.length,
      firstSeenDate: occurrences[0].date,
      suggestedType: 'loan',
      matchPattern:
        classification.matchPattern ?? escapeRegex(classification.creditor),
      creditor: classification.creditor,
      installment: {
        count: normalizedInstallmentCount,
        merchant: classification.merchant,
        occurrenceTxIds: occurrences.map((o) => o.transactionId),
        amounts: amountsAbs,
        dates: occurrences.map((o) => o.date),
      },
      source: 'llm_detection',
      evidence: DetectionValidatorService.buildEvidence(
        occurrences,
        classification.rationale,
      ),
    };

    await this.loanSuggestionsService.upsertMany(
      occurrences[occurrences.length - 1].statementId,
      [incoming],
    );
    return { created: true };
  }

  /**
   * Round 3 fix 1 : route une sous-série longue (≥6 occurrences, montant
   * stable par construction de `splitByAmount`) vers une suggestion
   * `subscription` plutôt qu'`installment` — sans champ `installment`
   * (ce n'est pas un plan N×), label désambiguïsé par montant seulement
   * si le cluster porte plusieurs sous-séries.
   */
  private async createSubscriptionFromSeries(
    occurrences: ClusterOccurrence[],
    classification: ClusterClassification,
    creditorNames: CreditorNames,
    medianAmount: number,
    disambiguate: boolean,
  ): Promise<ValidationResult> {
    const dismissed = await this.subscriptionGuardReason(
      creditorNames,
      medianAmount,
    );
    if (dismissed) return { created: false, reason: dismissed };

    return this.emitSubscription(
      occurrences,
      classification,
      medianAmount,
      disambiguate,
    );
  }

  /** Construit et persiste la suggestion `subscription` d'une série déjà
   *  validée (anti-re-suggestion comprise). */
  private async emitSubscription(
    occurrences: ClusterOccurrence[],
    classification: ClusterClassification,
    medianAmount: number,
    disambiguate: boolean,
  ): Promise<ValidationResult> {
    const base = DetectionValidatorService.buildLabel(classification);
    const label = disambiguate ? `${base} (${medianAmount}€)` : base;

    const incoming: IncomingSuggestion = {
      label,
      monthlyAmount: medianAmount,
      occurrencesSeen: occurrences.length,
      firstSeenDate: occurrences[0].date,
      suggestedType: 'subscription',
      matchPattern:
        classification.matchPattern ?? escapeRegex(classification.creditor),
      creditor: classification.creditor,
      source: 'llm_detection',
      evidence: DetectionValidatorService.buildEvidence(
        occurrences,
        classification.rationale,
      ),
    };

    await this.loanSuggestionsService.upsertMany(
      occurrences[occurrences.length - 1].statementId,
      [incoming],
    );
    return { created: true };
  }

  /**
   * Backlog revue 2026-08-13 #3 : la branche subscription transmettait la
   * classification LLM telle quelle — 2 occurrences à 4 jours d'écart
   * pouvaient devenir une suggestion « abonnement ».
   *
   * Comme la branche installment, le cluster est d'abord découpé en
   * sous-séries par montant (`splitByAmount`, ±5 %) : un cluster
   * d'opérateur mêle souvent plusieurs abonnements prélevés à quelques
   * jours d'écart, dont les intervalles mélangés (1-2 j / ~27 j) ne sont
   * pas mensuels alors que chaque abonnement l'est. Chaque sous-série
   * ≥ 2 occurrences est contrôlée (`checkSubscriptionSeries`) ; chaque
   * sous-série retenue produit SA suggestion, montant suffixé au libellé
   * seulement s'il y a plus d'une sous-série ÉMISE.
   *
   * Ordre d'émission : dernière occurrence croissante (la plus récente en
   * dernier). Depuis L44, `upsertMany` dédoublonne les suggestions
   * subscription par créancier + montant ±5 % : chaque sous-série émise
   * persiste la sienne.
   *
   * Repli (montant variable : énergie, téléphone à la consommation) : si
   * AUCUNE sous-série n'est émise, une seule série est contrôlée — les
   * occurrences postérieures à la dernière occurrence de la sous-série
   * morte la plus récente (ancien tarif exclu de la médiane), ou tout le
   * cluster s'il n'y en a pas — montant médian, libellé sans suffixe. Pas
   * de repli si une sous-série a été écartée par l'anti-re-suggestion :
   * la médiane mélangée re-proposerait ce que l'utilisateur a écarté.
   * Logique provisoire : un lot ultérieur la remplacera par un tri
   * déterministe (liste des établissements de crédit).
   */
  private async validateSubscription(
    cluster: CandidateCluster,
    classification: ClusterClassification,
    latestStatementDate: string,
  ): Promise<ValidationResult> {
    const byDate = (a: ClusterOccurrence, b: ClusterOccurrence) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    const lastDateOf = (occurrences: ClusterOccurrence[]) =>
      DetectionValidatorService.maxDate(occurrences.map((o) => o.date));
    const subSeries = DetectionValidatorService.splitByAmount(
      cluster.occurrences,
    )
      .filter((occurrences) => occurrences.length >= 2)
      .sort((a, b) => {
        const la = lastDateOf(a);
        const lb = lastDateOf(b);
        return la < lb ? -1 : la > lb ? 1 : 0;
      });

    const creditorNames = DetectionValidatorService.creditorNames(
      cluster,
      classification,
    );
    const accepted: { occurrences: ClusterOccurrence[]; median: number }[] = [];
    let lastReason: string | undefined;
    let guardBlocked = false;
    let lastDeadDate: string | null = null;

    for (const occurrences of subSeries) {
      const check = await this.checkSubscriptionSeries(
        occurrences,
        creditorNames,
        latestStatementDate,
      );
      if (check.ok) {
        accepted.push({ occurrences, median: check.medianAmount });
        continue;
      }
      lastReason = check.reason;
      if (check.guard) guardBlocked = true;
      if (check.reason === 'series_ended') {
        const last = lastDateOf(occurrences);
        if (!lastDeadDate || last > lastDeadDate) lastDeadDate = last;
      }
    }

    if (accepted.length > 0) {
      const disambiguate = accepted.length > 1;
      for (const { occurrences, median } of accepted) {
        await this.emitSubscription(
          occurrences,
          classification,
          median,
          disambiguate,
        );
      }
      return { created: true, createdCount: accepted.length };
    }

    if (guardBlocked) {
      return {
        created: false,
        reason: lastReason ?? 'subscription_already_dismissed',
      };
    }

    const fallback = cluster.occurrences
      .filter((o) => !lastDeadDate || o.date > lastDeadDate)
      .sort(byDate);
    if (fallback.length < 2 && lastReason) {
      return { created: false, reason: lastReason };
    }
    const check = await this.checkSubscriptionSeries(
      fallback,
      creditorNames,
      latestStatementDate,
    );
    if (!check.ok) return { created: false, reason: check.reason };
    await this.emitSubscription(
      fallback,
      classification,
      check.medianAmount,
      false,
    );
    return { created: true, createdCount: 1 };
  }

  /**
   * Contrôles d'une série d'abonnement candidate, sans rien persister :
   *  0. fraîcheur (`series_ended`, même garde que
   *     `validateInstallmentSubSeries`) — un ancien tarif ou une option
   *     résiliée n'est pas suggéré ;
   *  1. ≥MIN_SUBSCRIPTION_DISTINCT_MONTHS mois calendaires distincts ->
   *     sinon `subscription_insufficient_recurrence` ;
   *  2. espacement mensuel (`checkIntervals`, mêmes bornes que la branche
   *     installment) -> sinon `subscription_interval_out_of_range` ;
   *  3. anti-re-suggestion (`subscriptionGuardReason`, `guard: true`).
   */
  private async checkSubscriptionSeries(
    occurrences: ClusterOccurrence[],
    creditorNames: CreditorNames,
    latestStatementDate: string,
  ): Promise<
    | { ok: true; medianAmount: number }
    | { ok: false; reason: string; guard?: boolean }
  > {
    if (occurrences.length === 0) {
      return { ok: false, reason: 'subscription_insufficient_recurrence' };
    }
    if (
      DetectionValidatorService.daysBetween(
        DetectionValidatorService.maxDate(occurrences.map((o) => o.date)),
        latestStatementDate,
      ) > SERIES_ENDED_MAX_DAYS
    ) {
      return { ok: false, reason: 'series_ended' };
    }

    const distinctMonths = new Set(occurrences.map((o) => o.date.slice(0, 7)));
    if (distinctMonths.size < MIN_SUBSCRIPTION_DISTINCT_MONTHS) {
      return { ok: false, reason: 'subscription_insufficient_recurrence' };
    }
    if (!DetectionValidatorService.checkIntervals(occurrences)) {
      return { ok: false, reason: 'subscription_interval_out_of_range' };
    }

    const medianAmount = DetectionValidatorService.round2(
      DetectionValidatorService.median(
        occurrences.map((o) => Math.abs(o.amount)),
      ),
    );
    const dismissed = await this.subscriptionGuardReason(
      creditorNames,
      medianAmount,
    );
    if (dismissed) return { ok: false, reason: dismissed, guard: true };
    return { ok: true, medianAmount };
  }

  /**
   * Backlog revue 2026-08-13 #3 — équivalent subscriptions de
   * `hasFuzzyKnownLoanPayment` (containment fuzzy sur le nom LLM ET
   * `cluster.creditor`, montant ±5 %) :
   *  - abonnement déjà suivi (actif ou non, creditor ou à défaut nom)
   *    -> `existing_subscription` ;
   *  - suggestion déjà refusée ou mise en attente (snoozed), quel que soit
   *    son type -> `subscription_already_dismissed`. `upsertMany` ne protège
   *    que le creditor exact : un alias LLM différent recréait une
   *    suggestion pending que l'utilisateur avait déjà écartée.
   * Retourne null si rien ne bloque.
   */
  private async subscriptionGuardReason(
    creditorNames: CreditorNames,
    medianAmount: number,
  ): Promise<string | null> {
    if (!creditorNames.llm && !creditorNames.clusterToken) return null;
    const withinTolerance = (reference: number) =>
      Math.abs(medianAmount - reference) <= reference * AMOUNT_TOLERANCE;

    const subscriptions = await this.subscriptionsService.getAll();
    const known = subscriptions.some(
      (sub) =>
        (DetectionValidatorService.fuzzyCreditorMatch(
          sub.creditor,
          creditorNames,
        ) ||
          DetectionValidatorService.fuzzyCreditorMatch(
            sub.name,
            creditorNames,
          )) &&
        withinTolerance(sub.monthlyAmount),
    );
    if (known) return 'existing_subscription';

    if (await this.hasDismissedSuggestion(creditorNames, medianAmount)) {
      return 'subscription_already_dismissed';
    }

    return null;
  }

  /**
   * Anti-re-suggestion commune (L2 pour les abonnements, étendue aux crédits
   * et N× par L44, ex-L43) : une suggestion déjà refusée, ou mise en attente
   * PAR L'UTILISATEUR (`resolvedBy: 'user'` — les reports d'auto-sync ne
   * comptent pas, sinon la détection ne fusionnait plus son échéancier N×
   * dans la suggestion en attente), quel que soit son type, au même montant ±5 % et dont le
   * créancier matche en fuzzy (nom LLM ou `cluster.creditor`). `upsertMany`
   * ne protège que le creditor exact : un alias différent recréait une
   * suggestion pending que l'utilisateur avait déjà écartée.
   */
  private async hasDismissedSuggestion(
    creditorNames: CreditorNames,
    medianAmount: number,
  ): Promise<boolean> {
    if (!creditorNames.llm && !creditorNames.clusterToken) return false;
    const suggestions = await this.loanSuggestionsService.getAll();
    return suggestions.some(
      (sug) =>
        (sug.status === 'rejected' ||
          (sug.status === 'snoozed' && sug.resolvedBy === 'user')) &&
        DetectionValidatorService.fuzzyCreditorMatch(
          sug.creditor,
          creditorNames,
        ) &&
        Math.abs(medianAmount - sug.monthlyAmount) <=
          sug.monthlyAmount * AMOUNT_TOLERANCE,
    );
  }

  /**
   * Round 3 fix 2 : garde créancier existant fuzzy, vérifiée AVANT
   * `findExistingLoan` (qui exige un match exact/heuristique sur
   * creditor+matchPattern). `findExistingLoan` ratait des crédits réels
   * quand le creditor extrait par le LLM du cluster ('carrefour') diverge
   * du creditor stocké sur le Loan ('CARREFOUR BANQUE'). Normalise
   * (lowercase, trim) et matche par containment dans les deux sens, et
   * exige un montant proche (±5%) du `monthlyPayment` du loan pour éviter
   * de bloquer un cluster sans rapport chez le même créancier (ex.
   * Carrefour Market vs Carrefour Banque).
   *
   * Round 5 fix 2 : matche TOUS les loans, actifs ET inactifs (renommé en
   * conséquence — ex-`hasFuzzyActiveLoanPayment`). Un crédit tracké puis
   * clôturé (ex. LBP Consumer Finance) ne doit jamais être re-suggéré : le
   * fait qu'il soit `isActive:false` ne le rend pas invisible pour ce
   * garde, seulement pour le reste de l'app.
   */
  private async hasFuzzyKnownLoanPayment(
    creditorNames: CreditorNames,
    medianAmount: number,
  ): Promise<boolean> {
    if (!creditorNames.llm && !creditorNames.clusterToken) return false;
    const loans = await this.loansService.getAll();
    return loans.some((loan) => {
      if (
        !DetectionValidatorService.fuzzyCreditorMatch(
          loan.creditor,
          creditorNames,
        )
      ) {
        return false;
      }
      const tolerance = loan.monthlyPayment * AMOUNT_TOLERANCE;
      return Math.abs(medianAmount - loan.monthlyPayment) <= tolerance;
    });
  }

  /**
   * Backlog revue 2026-08-13 #2 : `findExistingLoan` interrogé pour CHAQUE
   * nom de créancier connu du cluster (LLM puis déterministe) — un match
   * high/medium sur l'un des deux suffit à bloquer la suggestion.
   */
  private async hasExistingLoanMatch(
    creditorNames: CreditorNames,
    monthlyAmount: number,
    description: string,
  ): Promise<boolean> {
    const names = [creditorNames.llm, creditorNames.clusterToken].filter(
      (n): n is string => !!n,
    );
    if (
      names.length === 2 &&
      names[0].toLowerCase().trim() === names[1].toLowerCase().trim()
    ) {
      names.pop();
    }
    for (const creditor of names) {
      const match = await this.loansService.findExistingLoan({
        creditor,
        monthlyAmount,
        description,
      });
      if (
        match &&
        (match.confidence === 'high' || match.confidence === 'medium')
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Backlog revue 2026-08-13 #2 : les gardes « créancier existant » ne
   * reposent plus sur le seul `classification.creditor` (sortie LLM, alias
   * variable : SOFINCO vs CA CONSUMER FINANCE) — elles croisent aussi le
   * `cluster.creditor` déterministe. Ce dernier n'est que le premier mot du
   * libellé : un mot générique (`GENERIC_CLUSTER_TOKENS`) est écarté.
   */
  private static creditorNames(
    cluster: CandidateCluster,
    classification: ClusterClassification,
  ): CreditorNames {
    const llm = (classification.creditor ?? '').trim();
    const token = (cluster.creditor ?? '').toLowerCase().trim();
    return {
      llm: llm || null,
      clusterToken: token && !GENERIC_CLUSTER_TOKENS.has(token) ? token : null,
    };
  }

  /** Vrai si `knownCreditor` correspond au nom LLM (containment fuzzy dans
   *  les deux sens, comportement historique) ou au jeton déterministe du
   *  cluster (mot entier, cf `tokenCreditorMatch`). */
  private static fuzzyCreditorMatch(
    knownCreditor: string | undefined,
    creditorNames: CreditorNames,
  ): boolean {
    const normalizedKnown = (knownCreditor ?? '').toLowerCase().trim();
    if (!normalizedKnown) return false;
    const llm = (creditorNames.llm ?? '').toLowerCase().trim();
    if (
      llm &&
      (normalizedKnown.includes(llm) || llm.includes(normalizedKnown))
    ) {
      return true;
    }
    return creditorNames.clusterToken
      ? DetectionValidatorService.tokenCreditorMatch(
          normalizedKnown,
          creditorNames.clusterToken,
        )
      : false;
  }

  /**
   * Correspondance du jeton déterministe (`cluster.creditor`) : égalité
   * stricte du nom entier toujours acceptée ; sinon, seulement si le jeton
   * fait au moins MIN_CLUSTER_TOKEN_WORD_LENGTH caractères, comme suite de
   * MOTS ENTIERS du nom connu (« zorbank » dans « zorbank credit », jamais
   * « ca » dans « carrefour banque » ni « cofi » dans « cofinor »).
   */
  private static tokenCreditorMatch(
    normalizedKnown: string,
    token: string,
  ): boolean {
    if (normalizedKnown === token) return true;
    if (token.length < MIN_CLUSTER_TOKEN_WORD_LENGTH) return false;
    const words = (value: string) =>
      value.split(/[^a-z0-9à-ÿ]+/).filter(Boolean);
    const knownWords = words(normalizedKnown);
    const tokenWords = words(token);
    if (tokenWords.length === 0) return false;
    for (let i = 0; i + tokenWords.length <= knownWords.length; i++) {
      if (tokenWords.every((w, j) => knownWords[i + j] === w)) return true;
    }
    return false;
  }

  /**
   * Regroupe les occurrences en sous-séries par montant : clustering
   * glouton sur les montants triés, deux occurrences dans la même
   * sous-série si leurs montants absolus sont à ±5 % l'un de l'autre
   * (tolérance mesurée contre la moyenne courante du bucket, comme
   * `LoansService.splitByAmount`). Chaque bucket est ensuite re-trié par
   * date croissante (ordre attendu par `checkIntervals`).
   */
  static splitByAmount(
    occurrences: ClusterOccurrence[],
  ): ClusterOccurrence[][] {
    const sorted = [...occurrences].sort(
      (a, b) => Math.abs(a.amount) - Math.abs(b.amount),
    );
    const buckets: ClusterOccurrence[][] = [];
    for (const o of sorted) {
      const amt = Math.abs(o.amount);
      const last = buckets[buckets.length - 1];
      const lastAvg = last
        ? last.reduce((s, x) => s + Math.abs(x.amount), 0) / last.length
        : 0;
      const tolerance = lastAvg * AMOUNT_TOLERANCE;
      if (last && Math.abs(amt - lastAvg) <= tolerance) {
        last.push(o);
      } else {
        buckets.push([o]);
      }
    }
    return buckets.map((bucket) =>
      [...bucket].sort((a, b) =>
        a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
      ),
    );
  }

  /**
   * Round 6 fix : la branche standard-loan (revolving/classic) ne
   * vérifiait pas l'invariant métier "1 débit/mois max par crédit"
   * (cf CLAUDE.md APEX 06) ni la stabilité du jour de prélèvement — un
   * cluster à plusieurs occurrences/mois et montants variables (38 occ
   * sur 10 mois observées en prod) pouvait être suggéré comme crédit.
   * Trois checks structurels, APRÈS le garde fraîcheur de `validate()` et
   * AVANT tout appel à `loansService` :
   *  1. ≤1 occurrence par mois calendaire (un crédit ne se débite jamais
   *     2× le même mois) -> `loan_multiple_per_month`.
   *  2. ≥MIN_LOAN_DISTINCT_MONTHS mois calendaires distincts (sinon pas
   *     assez de récurrence pour affirmer un crédit — les N× courts
   *     restent gérés par la branche installment, non touchée ici) ->
   *     `loan_insufficient_recurrence`.
   *  3. Jour du mois stable : un crédit tombe le même jour à quelques
   *     jours près (décalages week-ends/fériés). Écart à la médiane des
   *     jours-du-mois, en distance circulaire (gère la fin de mois,
   *     ex. 28 vs 2) -> `loan_irregular_day` si un écart dépasse
   *     MAX_DAY_OF_MONTH_DRIFT.
   */
  private async validateStandardLoan(
    cluster: CandidateCluster,
    classification: ClusterClassification,
  ): Promise<ValidationResult> {
    const occurrences = cluster.occurrences;
    const creditorNames = DetectionValidatorService.creditorNames(
      cluster,
      classification,
    );

    const months = occurrences.map((o) => o.date.slice(0, 7));
    const distinctMonths = new Set(months);
    if (distinctMonths.size !== months.length) {
      return { created: false, reason: 'loan_multiple_per_month' };
    }
    if (distinctMonths.size < MIN_LOAN_DISTINCT_MONTHS) {
      return { created: false, reason: 'loan_insufficient_recurrence' };
    }

    const daysOfMonth = occurrences.map((o) => Number(o.date.slice(8, 10)));
    const medianDay = DetectionValidatorService.median(daysOfMonth);
    const hasIrregularDay = daysOfMonth.some((d) => {
      const diff = Math.abs(d - medianDay);
      return Math.min(diff, 31 - diff) > MAX_DAY_OF_MONTH_DRIFT;
    });
    if (hasIrregularDay) {
      return { created: false, reason: 'loan_irregular_day' };
    }

    const amountsAbs = occurrences.map((o) => Math.abs(o.amount));
    const medianAmount = DetectionValidatorService.round2(
      DetectionValidatorService.median(amountsAbs),
    );

    if (await this.hasFuzzyKnownLoanPayment(creditorNames, medianAmount)) {
      return { created: false, reason: 'existing_loan_payment' };
    }

    if (await this.hasDismissedSuggestion(creditorNames, medianAmount)) {
      return { created: false, reason: 'loan_already_dismissed' };
    }

    if (
      await this.hasExistingLoanMatch(
        creditorNames,
        medianAmount,
        occurrences[occurrences.length - 1].description,
      )
    ) {
      return { created: false, reason: 'existing_loan_match' };
    }

    return this.createSuggestion(cluster, classification, 'loan');
  }

  private async createSuggestion(
    cluster: CandidateCluster,
    classification: ClusterClassification,
    suggestedType: 'loan' | 'subscription',
  ): Promise<ValidationResult> {
    const occurrences = cluster.occurrences;
    const amountsAbs = occurrences.map((o) => Math.abs(o.amount));
    const medianAmount = DetectionValidatorService.round2(
      DetectionValidatorService.median(amountsAbs),
    );

    const incoming: IncomingSuggestion = {
      label: DetectionValidatorService.buildLabel(classification),
      monthlyAmount: medianAmount,
      occurrencesSeen: occurrences.length,
      firstSeenDate: occurrences[0].date,
      suggestedType,
      matchPattern:
        classification.matchPattern ?? escapeRegex(classification.creditor),
      creditor: classification.creditor,
      source: 'llm_detection',
      evidence: DetectionValidatorService.buildEvidence(
        occurrences,
        classification.rationale,
      ),
    };

    await this.loanSuggestionsService.upsertMany(
      occurrences[occurrences.length - 1].statementId,
      [incoming],
    );
    return { created: true };
  }

  private static buildLabel(
    classification: ClusterClassification,
    prefix?: string,
  ): string {
    const base = prefix
      ? `${prefix} ${classification.creditor}`
      : classification.creditor;
    return classification.merchant
      ? `${base} · ${classification.merchant}`
      : base;
  }

  /**
   * true si l'espacement entre occurrences consécutives est cohérent avec
   * un rythme mensuel : médiane des intervalles dans [25,35]j si ≥2
   * intervalles, ou l'unique intervalle dans [20,40]j s'il n'y en a qu'un.
   * Une seule occurrence (0 intervalle) ne peut pas être invalidée ici.
   */
  static checkIntervals(occurrences: ClusterOccurrence[]): boolean {
    if (occurrences.length < 2) return true;
    const intervals: number[] = [];
    for (let i = 1; i < occurrences.length; i++) {
      intervals.push(
        DetectionValidatorService.daysBetween(
          occurrences[i - 1].date,
          occurrences[i].date,
        ),
      );
    }
    if (intervals.length === 1) {
      return (
        intervals[0] >= INTERVAL_SINGLE_MIN_DAYS &&
        intervals[0] <= INTERVAL_SINGLE_MAX_DAYS
      );
    }
    const medianInterval = DetectionValidatorService.median(intervals);
    return (
      medianInterval >= INTERVAL_MULTI_MIN_DAYS &&
      medianInterval <= INTERVAL_MULTI_MAX_DAYS
    );
  }

  private static daysBetween(from: string, to: string): number {
    return Math.round(
      (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000,
    );
  }

  private static maxDate(dates: string[]): string {
    return dates.reduce((max, d) => (d > max ? d : max), dates[0]);
  }

  /**
   * Round 5 fix 1 : preuves persistées derrière une suggestion — occurrences
   * plafonnées aux MAX_EVIDENCE_OCCURRENCES plus récentes, rationale de la
   * ClusterClassification, lastSeenDate = dernière occurrence observée.
   * Appelée depuis les 3 points de création de suggestion (installment,
   * subscription reroutée depuis une série longue, loan/subscription
   * standard) pour que TOUTE suggestion issue de la détection en porte une.
   */
  private static buildEvidence(
    occurrences: ClusterOccurrence[],
    rationale: string,
  ): SuggestionEvidence {
    const sorted = [...occurrences].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    );
    const capped = sorted.slice(-MAX_EVIDENCE_OCCURRENCES);
    return {
      occurrences: capped.map((o) => ({
        date: o.date,
        amount: Math.abs(o.amount),
        description: o.description,
      })),
      rationale,
      lastSeenDate: sorted[sorted.length - 1].date,
    };
  }

  private static median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
    return sorted[mid];
  }

  private static round2(value: number): number {
    return Math.round(value * 100) / 100;
  }

  /**
   * Round 8 fix 1 : l'installmentCount du LLM est un signal NON FIABLE —
   * cas réel où qwen3 a inventé "8×" (puis "6×") pour des plans Klarna qui
   * étaient en réalité des 3× (vérité Zalando confirmée par l'utilisateur).
   * Ramène à `null` (jamais de chiffre fabriqué dans la suggestion) tout
   * count qui n'appartient pas aux découpages français usuels
   * `ALLOWED_INSTALLMENT_COUNTS`, OU qui dépasse les occurrences déjà
   * observées + `INSTALLMENT_COUNT_PROJECTION_MARGIN` (le plafond +2 borne
   * les échéances futures projetables — pas de preuve au-delà).
   */
  private static normalizeInstallmentCount(
    rawCount: number | null,
    observedCount: number,
  ): number | null {
    if (rawCount == null) return null;
    if (!ALLOWED_INSTALLMENT_COUNTS.has(rawCount)) return null;
    if (rawCount > observedCount + INSTALLMENT_COUNT_PROJECTION_MARGIN) {
      return null;
    }
    return rawCount;
  }
}
