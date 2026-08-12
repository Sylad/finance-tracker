import { Injectable } from '@nestjs/common';
import { LoansService } from '../loans/loans.service';
import { StorageService } from '../storage/storage.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SavingsService } from '../savings/savings.service';
import { HealthThresholdsService } from './health-thresholds.service';
import {
  collectDrawTxIds,
  detectStableIncome,
  IncomeDetection,
} from './income-detection.helper';
import {
  HealthBlockResult,
  HealthDiagnostic,
  HealthStatus,
  HealthThresholds,
} from '../../models/health.model';
import { MonthlyStatement } from '../../models/monthly-statement.model';
import { Loan } from '../../models/loan.model';
import { Subscription } from '../../models/subscription.model';

export interface HealthContext {
  statements: MonthlyStatement[];
  loans: Loan[];
  subscriptions: Subscription[];
  thresholds: HealthThresholds;
  income: IncomeDetection;
  // transactionId de tous les mouvements d'épargne (tous comptes confondus) —
  // même périmètre que l'exclusion déjà appliquée au calcul du revenu (F7).
  // Réutilisé par `computeResteAVivre`/`findNeutralPairs` (fix review Task 7,
  // 2026-08-12) : un retrait/virement d'épargne ne doit jamais former une
  // paire neutre fantôme avec une dépense courante coïncidant en montant/date,
  // ni être compté comme une dépense courante lui-même.
  savingsMovementTxIds: Set<string>;
}

const RECENT_STATEMENTS_COUNT = 3;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly loansService: LoansService,
    private readonly storageService: StorageService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly savingsService: SavingsService,
    private readonly thresholdsService: HealthThresholdsService,
  ) {}

  /** Une seule lecture de chaque service source pour construire le contexte du diagnostic. */
  async buildContext(): Promise<HealthContext> {
    const [statements, loans, subscriptions, savingsAccounts, thresholds] =
      await Promise.all([
        this.storageService.getAllStatements(),
        this.loansService.getAll(),
        this.subscriptionsService.getAll(),
        this.savingsService.getAll(),
        this.thresholdsService.get(),
      ]);
    // Revenu : exclut les tirages sur réserve (dette qui rentre, pas un
    // revenu) ET les mouvements d'épargne entrants (spec §1 : « hors
    // mouvements d'épargne entrants » — F7, 2026-08-12). Un virement
    // récurrent vers un Livret A/PEL/etc. ne doit jamais être détecté
    // comme un cluster de revenu stable.
    const savingsMovementTxIds = new Set<string>();
    for (const account of savingsAccounts) {
      for (const movement of account.movements) {
        if (movement.transactionId)
          savingsMovementTxIds.add(movement.transactionId);
      }
    }
    const excludedTxIds = collectDrawTxIds(loans);
    for (const txId of savingsMovementTxIds) excludedTxIds.add(txId);
    const income = detectStableIncome(
      statements,
      excludedTxIds,
      thresholds.manualMonthlyIncome,
    );
    return {
      statements,
      loans,
      subscriptions,
      thresholds,
      income,
      savingsMovementTxIds,
    };
  }

  /** Les 3 derniers relevés, triés par (year, month) décroissant. */
  private lastStatements(
    ctx: HealthContext,
    count: number,
  ): MonthlyStatement[] {
    return [...ctx.statements]
      .sort((a, b) => b.year - a.year || b.month - a.month)
      .slice(0, count);
  }

  /** Ensemble des transactionId qui sont des occurrences de loans (toutes sources confondues). */
  private loanOccurrenceTxIds(loans: Loan[]): Set<string> {
    const ids = new Set<string>();
    for (const loan of loans) {
      for (const occ of loan.occurrencesDetected) {
        if (occ.transactionId) ids.add(occ.transactionId);
      }
    }
    return ids;
  }

  /**
   * Ensemble des transactionId qui sont des occurrences d'abonnements
   * ACTIFS uniquement (re-review F4, 2026-08-12) — symétrique avec
   * `abonnementsMensuels` qui ne somme que `s.isActive`. Un abonnement
   * résilié récemment garde des occurrences dans la fenêtre des 3 derniers
   * relevés ; ses tx ont bien été payées et doivent retomber dans
   * `depensesCourantes`, pas disparaître sans être comptées nulle part
   * (sinon reste à vivre surestimé silencieusement).
   */
  private subscriptionOccurrenceTxIds(
    subscriptions: Subscription[],
  ): Set<string> {
    const ids = new Set<string>();
    for (const sub of subscriptions) {
      if (!sub.isActive) continue;
      for (const occ of sub.occurrencesDetected) {
        if (occ.transactionId) ids.add(occ.transactionId);
      }
    }
    return ids;
  }

  /**
   * Moyenne sur les 3 derniers relevés des dépenses courantes (débits) hors
   * occurrences de crédits ET hors occurrences d'abonnements (F4) — les
   * abonnements sont comptés séparément (`abonnementsMensuels`), les
   * inclure aussi ici les compterait deux fois dans le reste à vivre.
   */
  private averageDepensesCourantesHorsCredits(
    ctx: HealthContext,
    extraExcludedTxIds: Set<string> = new Set(),
  ): number {
    const recent = this.lastStatements(ctx, RECENT_STATEMENTS_COUNT);
    if (recent.length === 0) return 0;
    const loanTxIds = this.loanOccurrenceTxIds(ctx.loans);
    const subTxIds = this.subscriptionOccurrenceTxIds(ctx.subscriptions);
    const totalPerStatement = recent.map((st) =>
      st.transactions
        .filter(
          (t) =>
            t.amount < 0 &&
            !loanTxIds.has(t.id) &&
            !subTxIds.has(t.id) &&
            !extraExcludedTxIds.has(t.id),
        )
        .reduce((sum, t) => sum + Math.abs(t.amount), 0),
    );
    const total = totalPerStatement.reduce((sum, v) => sum + v, 0);
    return total / recent.length;
  }

  private mensualitesTotal(loans: Loan[]): number {
    return loans
      .filter((l) => l.isActive)
      .reduce((sum, l) => sum + l.monthlyPayment, 0);
  }

  /**
   * Appariement (crédit entrant, débit sortant) sur la fenêtre des 3 derniers
   * relevés — mouvements « neutres » (ex : remboursement d'un proche suivi du
   * virement correspondant) qui ne sont ni une dépense ni un revenu réels.
   *
   * Règle (Task 7, 2026-08-12) : `|montant_in| - |montant_out| ≤ 0.01 €` et
   * écart de dates ≤ 7 jours. Exclusions : tx déjà exclues (loans/subs/
   * épargne, via `excludedTxIds`) et tx dont la description matche le
   * `matchPattern` d'un loan ACTIF (regex insensible à la casse, try/catch
   * sur pattern invalide — c'est un input utilisateur libre). Appariement
   * GLOUTON par proximité de date : les paires candidates sont triées par
   * écart croissant, chaque tx entre dans au plus une paire.
   *
   * Seule la jambe sortante est retournée pour exclusion : la jambe entrante
   * n'était de toute façon jamais comptée dans les dépenses courantes
   * (filtrées sur `amount < 0`) — l'effet net de l'appariement est donc le
   * retrait de la jambe sortante des dépenses courantes.
   */
  private findNeutralPairs(
    recent: MonthlyStatement[],
    loans: Loan[],
    excludedTxIds: Set<string>,
  ): { neutralOutgoingTxIds: Set<string>; operationsNeutres: number } {
    const activePatterns: RegExp[] = [];
    for (const loan of loans) {
      if (!loan.isActive || !loan.matchPattern) continue;
      try {
        activePatterns.push(new RegExp(loan.matchPattern, 'i'));
      } catch {
        // matchPattern invalide (saisie libre côté user) — ignoré silencieusement.
      }
    }
    const matchesActiveLoanPattern = (description: string): boolean =>
      activePatterns.some((re) => re.test(description));

    interface Candidate {
      id: string;
      date: number;
      amount: number;
    }
    const incoming: Candidate[] = [];
    const outgoing: Candidate[] = [];
    for (const st of recent) {
      for (const t of st.transactions) {
        if (t.amount === 0) continue;
        if (excludedTxIds.has(t.id)) continue;
        if (matchesActiveLoanPattern(t.description)) continue;
        const candidate: Candidate = {
          id: t.id,
          date: new Date(t.date).getTime(),
          amount: t.amount,
        };
        if (t.amount > 0) incoming.push(candidate);
        else outgoing.push(candidate);
      }
    }

    interface PairCandidate {
      inId: string;
      outId: string;
      outAmount: number;
      dateDiffDays: number;
    }
    const pairCandidates: PairCandidate[] = [];
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    for (const inTx of incoming) {
      for (const outTx of outgoing) {
        const amountDiff = Math.abs(Math.abs(inTx.amount) - Math.abs(outTx.amount));
        if (amountDiff > 0.01) continue;
        const dateDiffDays = Math.abs(inTx.date - outTx.date) / MS_PER_DAY;
        if (dateDiffDays > 7) continue;
        pairCandidates.push({
          inId: inTx.id,
          outId: outTx.id,
          outAmount: Math.abs(outTx.amount),
          dateDiffDays,
        });
      }
    }
    pairCandidates.sort((a, b) => a.dateDiffDays - b.dateDiffDays);

    const usedIn = new Set<string>();
    const usedOut = new Set<string>();
    const neutralOutgoingTxIds = new Set<string>();
    let operationsNeutres = 0;
    for (const pc of pairCandidates) {
      if (usedIn.has(pc.inId) || usedOut.has(pc.outId)) continue;
      usedIn.add(pc.inId);
      usedOut.add(pc.outId);
      neutralOutgoingTxIds.add(pc.outId);
      operationsNeutres += pc.outAmount;
    }

    return { neutralOutgoingTxIds, operationsNeutres };
  }

  computeResteAVivre(ctx: HealthContext): HealthBlockResult {
    const income = ctx.income.monthly as number;
    const mensualites = this.mensualitesTotal(ctx.loans);
    const loanTxIds = this.loanOccurrenceTxIds(ctx.loans);
    const subTxIds = this.subscriptionOccurrenceTxIds(ctx.subscriptions);
    const excludedTxIds = new Set<string>([
      ...loanTxIds,
      ...subTxIds,
      ...ctx.savingsMovementTxIds,
    ]);
    const recent = this.lastStatements(ctx, RECENT_STATEMENTS_COUNT);
    const { neutralOutgoingTxIds, operationsNeutres } = this.findNeutralPairs(
      recent,
      ctx.loans,
      excludedTxIds,
    );
    const depensesCourantes = this.averageDepensesCourantesHorsCredits(
      ctx,
      new Set([...neutralOutgoingTxIds, ...ctx.savingsMovementTxIds]),
    );
    const abonnementsMensuels = ctx.subscriptions
      .filter((s) => s.isActive)
      .reduce((sum, s) => sum + s.monthlyAmount, 0);

    const resteAVivre =
      income - mensualites - abonnementsMensuels - depensesCourantes;
    const pctIncome = income > 0 ? (resteAVivre / income) * 100 : 0;
    const { orangeBelowPctIncome } = ctx.thresholds.resteAVivre;

    let status: HealthStatus;
    let thresholdHit: string | null = null;
    if (resteAVivre < 0) {
      status = 'red';
      thresholdHit = `rouge car reste à vivre ${round2(resteAVivre)} € < 0 €`;
    } else if (pctIncome < orangeBelowPctIncome) {
      status = 'orange';
      thresholdHit = `orange car reste à vivre ${round1(pctIncome)} % du revenu < ${orangeBelowPctIncome} %`;
    } else {
      status = 'green';
    }

    return {
      status,
      thresholdHit,
      details: {
        resteAVivre: round2(resteAVivre),
        income: round2(income),
        mensualitesTotal: round2(mensualites),
        depensesCourantes: round2(depensesCourantes),
        abonnementsMensuels: round2(abonnementsMensuels),
        pctIncome: round1(pctIncome),
        operationsNeutres: round2(operationsNeutres),
      },
    };
  }

  computeChargeDette(ctx: HealthContext): HealthBlockResult {
    const income = ctx.income.monthly as number;
    const mensualites = this.mensualitesTotal(ctx.loans);
    const tauxEffortPct = income > 0 ? (mensualites / income) * 100 : 0;

    const revolvings = this.revolvingsActifs(ctx.loans);
    let pireReserveNom: string | null = null;
    let pireReservePct = 0;
    let sumUsed = 0;
    let sumMax = 0;
    for (const loan of revolvings) {
      // Le ratio plafond n'a de sens que pour les réserves avec un plafond
      // connu — skip silencieux ici (leurs tirages/remboursements sont
      // comptés ailleurs, dans computeFluxTirages/computeTrajectoire).
      if (loan.maxAmount == null || loan.maxAmount <= 0) continue;
      const used = loan.usedAmount ?? 0;
      const max = loan.maxAmount;
      sumUsed += used;
      sumMax += max;
      const pct = (used / max) * 100;
      if (pct > pireReservePct) {
        pireReservePct = pct;
        pireReserveNom = loan.name;
      }
    }
    const utilisationGlobalePct = sumMax > 0 ? (sumUsed / sumMax) * 100 : 0;

    const { orangeAbovePct: tauxOrange, redAbovePct: tauxRed } =
      ctx.thresholds.tauxEffort;
    // F2 : plus de seuil orange dédié pour les plafonds — vert si pire <
    // greenBelowPct, orange si pire >= greenBelowPct, rouge si pire >=
    // redAbovePct (décision d'auteur).
    const { greenBelowPct: plafondOrange, redAbovePct: plafondRed } =
      ctx.thresholds.plafonds;

    const tauxStatus: HealthStatus =
      tauxEffortPct > tauxRed
        ? 'red'
        : tauxEffortPct >= tauxOrange
          ? 'orange'
          : 'green';
    const plafondStatus: HealthStatus =
      pireReservePct >= plafondRed
        ? 'red'
        : pireReservePct >= plafondOrange
          ? 'orange'
          : 'green';

    const severity: Record<HealthStatus, number> = {
      green: 0,
      orange: 1,
      red: 2,
    };

    const status: HealthStatus =
      severity[plafondStatus] > severity[tauxStatus] ||
      (severity[plafondStatus] === severity[tauxStatus] &&
        plafondStatus !== 'green')
        ? plafondStatus
        : tauxStatus;

    let plafondReason: string | null = null;
    if (plafondStatus !== 'green') {
      const limit = plafondStatus === 'red' ? plafondRed : plafondOrange;
      const label = plafondStatus === 'red' ? 'rouge' : 'orange';
      // Plafonds : comparateur réel toujours ≥ (rouge "≥ 95 % ou dépassé", orange "≥ 60 %").
      plafondReason = `${label} car ${pireReserveNom} utilisé à ${round1(pireReservePct)} % ≥ ${limit} %`;
    }
    let tauxReason: string | null = null;
    if (tauxStatus !== 'green') {
      const label = tauxStatus === 'red' ? 'rouge' : 'orange';
      // Taux d'effort : rouge est strictement > (borne 50 % pile = orange), orange démarre à ≥ 33 %.
      const comparator = tauxStatus === 'red' ? '>' : '≥';
      const limit = tauxStatus === 'red' ? tauxRed : tauxOrange;
      tauxReason = `${label} car taux d'effort ${round1(tauxEffortPct)} % ${comparator} ${limit} %`;
    }

    // F9 : quand taux d'effort ET plafonds sont non-verts simultanément, les
    // deux causes sont exposées (concaténées) plutôt que de n'en montrer
    // qu'une seule et masquer l'autre — le pire des deux (déterminant
    // `status`) est cité en premier.
    const reasons =
      status === plafondStatus
        ? [plafondReason, tauxReason]
        : [tauxReason, plafondReason];
    const thresholdHit =
      reasons.filter((r): r is string => r != null).join(' ; ') || null;

    return {
      status,
      thresholdHit,
      details: {
        tauxEffortPct: round1(tauxEffortPct),
        mensualitesTotal: round2(mensualites),
        pireReserveNom,
        pireReservePct: round1(pireReservePct),
        utilisationGlobalePct: round1(utilisationGlobalePct),
      },
    };
  }

  /**
   * Réserves renouvelables actives — même critère que le producteur des
   * tirages (`auto-sync.service.syncDraws`) : `isActive` + `getLoanKind`.
   * Ne filtre PAS sur `maxAmount` : une réserve sans plafond connu doit
   * quand même voir ses tirages/remboursements comptés dans flux et
   * trajectoire (finding review F1, 2026-08-12). Les ratios qui nécessitent
   * un plafond (pireReservePct, projection de saturation) sont eux filtrés
   * localement dans `computeChargeDette`/`computeTrajectoire`.
   */
  private revolvingsActifs(loans: Loan[]): Loan[] {
    return loans.filter(
      (l) => l.isActive && LoansService.getLoanKind(l) === 'revolving',
    );
  }

  private inWindow(dateStr: string, start: Date, end: Date): boolean {
    const d = new Date(dateStr);
    return d >= start && d <= end;
  }

  /** Σ tirages (source='draw', amount>0) et Σ |remboursements| (amount<0) d'un loan sur la fenêtre. */
  private tiragesEtRemboursements(
    loan: Loan,
    start: Date,
    end: Date,
  ): { tirages: number; remboursements: number } {
    let tirages = 0;
    let remboursements = 0;
    for (const occ of loan.occurrencesDetected) {
      if (!this.inWindow(occ.date, start, end)) continue;
      if (occ.source === 'draw' && occ.amount > 0) {
        tirages += occ.amount;
      } else if (occ.amount < 0) {
        remboursements += Math.abs(occ.amount);
      }
    }
    return { tirages, remboursements };
  }

  /**
   * Fenêtre glissante de 3 mois (90 jours) se terminant aujourd'hui (runtime).
   * `start` est tronquée à minuit UTC : les dates d'occurrences (`YYYY-MM-DD`)
   * sont parsées par `new Date()` comme minuit UTC, donc comparer contre un
   * `start` à l'heure courante excluait silencieusement les occurrences
   * datées pile 90 jours avant (finding review Task 4, 2026-08-12).
   */
  private rollingWindow(): { start: Date; end: Date } {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 90);
    start.setUTCHours(0, 0, 0, 0);
    return { start, end };
  }

  /**
   * Fenêtre + réserves actives + Σ tirages/remboursements par loan, calculés
   * une seule fois — réutilisé par `computeFluxTirages` et `computeTrajectoire`
   * pour éviter de refaire le même parcours des occurrences deux fois par
   * appel à `getDiagnostic()`.
   */
  private reserveMetrics(ctx: HealthContext): {
    start: Date;
    end: Date;
    revolvings: Loan[];
    perLoan: Map<string, { tirages: number; remboursements: number }>;
  } {
    const { start, end } = this.rollingWindow();
    const revolvings = this.revolvingsActifs(ctx.loans);
    const perLoan = new Map<
      string,
      { tirages: number; remboursements: number }
    >();
    for (const loan of revolvings) {
      perLoan.set(loan.id, this.tiragesEtRemboursements(loan, start, end));
    }
    return { start, end, revolvings, perLoan };
  }

  computeFluxTirages(
    ctx: HealthContext,
    metrics: ReturnType<HealthService['reserveMetrics']> = this.reserveMetrics(
      ctx,
    ),
  ): HealthBlockResult {
    const income = ctx.income.monthly as number;

    let totalTirages = 0;
    let totalRemboursements = 0;
    for (const loan of metrics.revolvings) {
      const { tirages, remboursements } = metrics.perLoan.get(loan.id) ?? {
        tirages: 0,
        remboursements: 0,
      };
      totalTirages += tirages;
      totalRemboursements += remboursements;
    }
    const tiragesMensuels = totalTirages / 3;
    const remboursementsMensuels = totalRemboursements / 3;
    const flux = tiragesMensuels - remboursementsMensuels;

    const { redAbovePctIncome } = ctx.thresholds.tirages;
    const redThreshold = income > 0 ? (income * redAbovePctIncome) / 100 : 0;
    const pctIncome = income > 0 ? (flux / income) * 100 : 0;

    let status: HealthStatus;
    let thresholdHit: string | null = null;
    if (flux <= 0) {
      status = 'green';
    } else if (flux > redThreshold) {
      status = 'red';
      thresholdHit = `rouge car flux tirages ${round2(flux)} €/mois > ${redAbovePctIncome} % du revenu (${round2(redThreshold)} €)`;
    } else {
      status = 'orange';
      thresholdHit = `orange car tirages (${round2(tiragesMensuels)} €/mois) > remboursements (${round2(remboursementsMensuels)} €/mois)`;
    }

    return {
      status,
      thresholdHit,
      details: {
        tiragesMensuels: round2(tiragesMensuels),
        remboursementsMensuels: round2(remboursementsMensuels),
        flux: round2(flux),
        pctIncome: round1(pctIncome),
      },
    };
  }

  computeTrajectoire(
    ctx: HealthContext,
    metrics: ReturnType<HealthService['reserveMetrics']> = this.reserveMetrics(
      ctx,
    ),
  ): HealthBlockResult {
    const { horizonMonths, stableBandPct } = ctx.thresholds.trajectoire;

    const revolvings = metrics.revolvings;
    let sumUsed = 0;
    let sumProjected = 0;
    let saturatedLoanName: string | null = null;
    for (const loan of revolvings) {
      const used = loan.usedAmount ?? 0;
      const { tirages, remboursements } = metrics.perLoan.get(loan.id) ?? {
        tirages: 0,
        remboursements: 0,
      };
      // Le trend (tirages - remboursements) compte pour TOUTE réserve active,
      // avec ou sans plafond connu. Seule la détection de saturation
      // (comparaison au plafond) nécessite un `maxAmount` — skip pour les
      // réserves sans plafond connu (finding review F1, 2026-08-12).
      const trend = (tirages - remboursements) / 3;
      const projected = used + horizonMonths * trend;
      sumUsed += used;
      sumProjected += projected;
      const max = loan.maxAmount;
      if (
        max != null &&
        max > 0 &&
        saturatedLoanName === null &&
        projected >= max
      ) {
        saturatedLoanName = loan.name;
      }
    }

    const recent = this.lastStatements(ctx, RECENT_STATEMENTS_COUNT);
    const avgMonthlyBalance =
      recent.length > 0
        ? recent.reduce(
            (sum, st) => sum + (st.totalCredits - st.totalDebits),
            0,
          ) / recent.length
        : 0;

    let status: HealthStatus;
    let thresholdHit: string | null = null;
    if (revolvings.length === 0) {
      // Aucune réserve active : la trajectoire ne dépend que du solde
      // (jamais orange dans ce cas — décision d'auteur du plan 2026-08-12).
      if (avgMonthlyBalance < 0) {
        status = 'red';
        thresholdHit = `rouge car le solde mensuel moyen est structurellement négatif (${round2(avgMonthlyBalance)} €)`;
      } else {
        status = 'green';
      }
    } else if (saturatedLoanName !== null) {
      status = 'red';
      thresholdHit = `rouge car l'encours projeté de ${saturatedLoanName} atteint le plafond sous ${horizonMonths} mois`;
    } else if (avgMonthlyBalance < 0) {
      status = 'red';
      thresholdHit = `rouge car le solde mensuel moyen est structurellement négatif (${round2(avgMonthlyBalance)} €)`;
    } else if (sumProjected < sumUsed * (1 - stableBandPct / 100)) {
      status = 'green';
    } else {
      status = 'orange';
      thresholdHit = `orange car l'encours projeté reste stable (± ${stableBandPct} %) sous ${horizonMonths} mois`;
    }

    return {
      status,
      thresholdHit,
      details: {
        sumUsed: round2(sumUsed),
        sumProjected: round2(sumProjected),
        avgMonthlyBalance: round2(avgMonthlyBalance),
        horizonMonths,
      },
    };
  }

  async getDiagnostic(): Promise<HealthDiagnostic> {
    const ctx = await this.buildContext();
    const computedAt = new Date().toISOString();

    // Un revenu <= 0 (ex : manualMonthlyIncome persisté avant le clamp
    // d'écriture F3, ou tout futur chemin produisant un montant invalide)
    // est traité comme un revenu indisponible plutôt que de fausser
    // silencieusement les ratios (division par un nombre <= 0).
    if (ctx.income.monthly != null && ctx.income.monthly <= 0) {
      ctx.income = {
        monthly: null,
        source: 'unavailable',
        label: ctx.income.label,
      };
    }

    if (ctx.income.monthly == null) {
      const emptyBlock = (): HealthBlockResult => ({
        status: 'orange',
        thresholdHit: null,
        details: {},
      });
      return {
        verdict: 'orange',
        causes: ['revenus non configurés — diagnostic impossible'],
        blocks: {
          resteAVivre: emptyBlock(),
          chargeDette: emptyBlock(),
          fluxTirages: emptyBlock(),
          trajectoire: emptyBlock(),
        },
        income: {
          monthly: null,
          source: ctx.income.source,
          label: ctx.income.label,
        },
        reliability: 'unavailable',
        computedAt,
      };
    }

    // Calculé une seule fois — évite de reparcourir la fenêtre 90j et les
    // occurrences des réserves actives deux fois (fluxTirages + trajectoire).
    const metrics = this.reserveMetrics(ctx);

    const resteAVivre = this.computeResteAVivre(ctx);
    const chargeDette = this.computeChargeDette(ctx);
    const fluxTirages = this.computeFluxTirages(ctx, metrics);
    const trajectoire = this.computeTrajectoire(ctx, metrics);

    const severity: Record<HealthStatus, number> = {
      green: 0,
      orange: 1,
      red: 2,
    };
    const orderedBlocks = [resteAVivre, chargeDette, fluxTirages, trajectoire];
    const verdict = orderedBlocks.reduce<HealthStatus>(
      (worst, b) => (severity[b.status] > severity[worst] ? b.status : worst),
      'green',
    );
    const causes = orderedBlocks
      .filter((b) => b.status !== 'green' && b.thresholdHit)
      .map((b) => b.thresholdHit as string);

    const reliability: 'ok' | 'reduced' =
      ctx.statements.length < 3 ? 'reduced' : 'ok';

    return {
      verdict,
      causes,
      blocks: { resteAVivre, chargeDette, fluxTirages, trajectoire },
      income: {
        monthly: ctx.income.monthly,
        source: ctx.income.source,
        label: ctx.income.label,
      },
      reliability,
      computedAt,
    };
  }
}
