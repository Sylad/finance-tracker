import { Injectable } from '@nestjs/common';
import { LoansService } from '../loans/loans.service';
import { StorageService } from '../storage/storage.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
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
    private readonly thresholdsService: HealthThresholdsService,
  ) {}

  /** Une seule lecture de chaque service source pour construire le contexte du diagnostic. */
  async buildContext(): Promise<HealthContext> {
    const [statements, loans, subscriptions, thresholds] = await Promise.all([
      this.storageService.getAllStatements(),
      this.loansService.getAll(),
      this.subscriptionsService.getAll(),
      this.thresholdsService.get(),
    ]);
    const drawTxIds = collectDrawTxIds(loans);
    const income = detectStableIncome(
      statements,
      drawTxIds,
      thresholds.manualMonthlyIncome,
    );
    return { statements, loans, subscriptions, thresholds, income };
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

  /** Moyenne sur les 3 derniers relevés des dépenses courantes (débits) hors occurrences de crédits. */
  private averageDepensesCourantesHorsCredits(ctx: HealthContext): number {
    const recent = this.lastStatements(ctx, RECENT_STATEMENTS_COUNT);
    if (recent.length === 0) return 0;
    const loanTxIds = this.loanOccurrenceTxIds(ctx.loans);
    const totalPerStatement = recent.map((st) =>
      st.transactions
        .filter((t) => t.amount < 0 && !loanTxIds.has(t.id))
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

  computeResteAVivre(ctx: HealthContext): HealthBlockResult {
    const income = ctx.income.monthly as number;
    const mensualites = this.mensualitesTotal(ctx.loans);
    const depensesCourantes = this.averageDepensesCourantesHorsCredits(ctx);
    const abonnementsMensuels = ctx.subscriptions
      .filter((s) => s.isActive)
      .reduce((sum, s) => sum + s.monthlyAmount, 0);

    const resteAVivre = income - mensualites - depensesCourantes;
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
      const used = loan.usedAmount ?? 0;
      const max = loan.maxAmount as number;
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
    const { orangeAbovePct: plafondOrange, redAbovePct: plafondRed } =
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
    let status: HealthStatus;
    let thresholdHit: string | null = null;

    if (
      severity[plafondStatus] > severity[tauxStatus] ||
      (severity[plafondStatus] === severity[tauxStatus] &&
        plafondStatus !== 'green')
    ) {
      status = plafondStatus;
      if (status !== 'green') {
        const limit = status === 'red' ? plafondRed : plafondOrange;
        const label = status === 'red' ? 'rouge' : 'orange';
        // Plafonds : comparateur réel toujours ≥ (rouge "≥ 95 % ou dépassé", orange "≥ 80 %").
        thresholdHit = `${label} car ${pireReserveNom} utilisé à ${round1(pireReservePct)} % ≥ ${limit} %`;
      }
    } else {
      status = tauxStatus;
      if (status !== 'green') {
        const label = status === 'red' ? 'rouge' : 'orange';
        // Taux d'effort : rouge est strictement > (borne 50 % pile = orange), orange démarre à ≥ 33 %.
        const comparator = status === 'red' ? '>' : '≥';
        const limit = status === 'red' ? tauxRed : tauxOrange;
        thresholdHit = `${label} car taux d'effort ${round1(tauxEffortPct)} % ${comparator} ${limit} %`;
      }
    }

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

  /** Réserves renouvelables actives — même critère que le bloc chargeDette. */
  private revolvingsActifs(loans: Loan[]): Loan[] {
    return loans.filter(
      (l) => l.isActive && l.maxAmount != null && l.maxAmount > 0,
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
      const max = loan.maxAmount as number;
      const { tirages, remboursements } = metrics.perLoan.get(loan.id) ?? {
        tirages: 0,
        remboursements: 0,
      };
      const trend = (tirages - remboursements) / 3;
      const projected = used + horizonMonths * trend;
      sumUsed += used;
      sumProjected += projected;
      if (saturatedLoanName === null && projected >= max) {
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
