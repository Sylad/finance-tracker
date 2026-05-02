import { Injectable } from '@nestjs/common';
import { SavingsService } from '../savings/savings.service';
import { LoansService } from '../loans/loans.service';
import { StorageService } from '../storage/storage.service';

export interface NetWorth {
  closingBalance: number;
  totalSavings: number;
  estimatedDebt: number;
  netWorth: number;
  ignoredLoanIds: string[];
}

export type AlertSeverity = 'info' | 'warning' | 'critical';
export interface Alert { severity: AlertSeverity; message: string; link?: string; }

export interface YearlyOverview {
  monthly: { month: string; credits: number; debits: number; net: number }[];
  topCategories: { category: string; total: number }[];
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly savings: SavingsService,
    private readonly loans: LoansService,
    private readonly storage: StorageService,
  ) {}

  async getNetWorth(): Promise<NetWorth> {
    const [savings, loans, summaries] = await Promise.all([
      this.savings.getAll(),
      this.loans.getAll(),
      this.storage.getAllSummaries(),
    ]);
    const closing = summaries[0]?.closingBalance ?? 0;
    const totalSavings = savings.reduce((s, a) => s + a.currentBalance, 0);

    const ignoredLoanIds: string[] = [];
    let estimatedDebt = 0;
    const now = new Date();
    for (const l of loans.filter((x) => x.isActive && x.type === 'classic')) {
      if (!l.endDate || !l.monthlyPayment) {
        ignoredLoanIds.push(l.id);
        continue;
      }
      const end = new Date(l.endDate);
      const monthsRemaining = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30.44)));
      estimatedDebt += monthsRemaining * l.monthlyPayment;
    }
    for (const l of loans.filter((x) => x.isActive && x.type === 'revolving')) {
      estimatedDebt += l.usedAmount ?? 0;
    }

    const netWorth = Math.round((closing + totalSavings - estimatedDebt) * 100) / 100;
    return {
      closingBalance: closing,
      totalSavings: Math.round(totalSavings * 100) / 100,
      estimatedDebt: Math.round(estimatedDebt * 100) / 100,
      netWorth,
      ignoredLoanIds,
    };
  }

  async getAlerts(): Promise<Alert[]> {
    const alerts: Alert[] = [];
    const [loans, summaries] = await Promise.all([this.loans.getAll(), this.storage.getAllSummaries()]);
    for (const l of loans.filter((x) => x.isActive && x.type === 'revolving')) {
      if (l.maxAmount && l.usedAmount != null) {
        const pct = (l.usedAmount / l.maxAmount) * 100;
        if (pct >= 80) alerts.push({
          severity: pct >= 95 ? 'critical' : 'warning',
          message: `Revolving "${l.name}" à ${Math.round(pct)}% du plafond`,
          link: '/loans',
        });
      }
    }
    if (summaries.length >= 2) {
      const a = summaries[0].closingBalance, b = summaries[1].closingBalance;
      if (b > 0 && (a / b) <= 0.7) {
        alerts.push({
          severity: 'warning',
          message: `Solde en baisse de ${Math.round((1 - a / b) * 100)}% vs mois précédent`,
          link: '/history',
        });
      }
    }
    const now = new Date();
    for (const l of loans.filter((x) => x.isActive && x.type === 'classic' && x.endDate)) {
      const days = (new Date(l.endDate!).getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      if (days > 0 && days < 90) {
        alerts.push({
          severity: 'info',
          message: `Crédit "${l.name}" se termine dans ${Math.round(days)} jours`,
          link: '/loans',
        });
      }
    }
    return alerts;
  }

  async getYearlyOverview(months = 12): Promise<YearlyOverview> {
    const summaries = (await this.storage.getAllSummaries()).slice(0, months).reverse();
    const monthly = summaries.map((s) => ({
      month: `${s.year}-${String(s.month).padStart(2, '0')}`,
      credits: s.totalCredits,
      debits: s.totalDebits,
      net: s.totalCredits - s.totalDebits,
    }));

    const fullStatements = (await this.storage.getAllStatements()).slice(0, months);
    const catTotals = new Map<string, number>();
    for (const s of fullStatements) {
      for (const t of s.transactions) {
        if (t.amount < 0) {
          catTotals.set(t.category, (catTotals.get(t.category) ?? 0) + Math.abs(t.amount));
        }
      }
    }
    const topCategories = [...catTotals.entries()]
      .map(([category, total]) => ({ category, total: Math.round(total * 100) / 100 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    return { monthly, topCategories };
  }
}
