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

    const revolvings = ctx.loans.filter(
      (l) => l.isActive && l.maxAmount != null && l.maxAmount > 0,
    );
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
      tauxEffortPct >= tauxRed
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
        thresholdHit = `${label} car ${pireReserveNom} utilisé à ${round1(pireReservePct)} % > ${limit} %`;
      }
    } else {
      status = tauxStatus;
      if (status !== 'green') {
        const limit = status === 'red' ? tauxRed : tauxOrange;
        const label = status === 'red' ? 'rouge' : 'orange';
        thresholdHit = `${label} car taux d'effort ${round1(tauxEffortPct)} % > ${limit} %`;
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
}
