import { Injectable } from '@nestjs/common';
import { Declaration, ForecastMonth, ForecastOccurrence } from '../../models/declaration.model';
import { DeclarationsService } from './declarations.service';
import { StorageService } from '../storage/storage.service';
import { MonthlyStatement } from '../../models/monthly-statement.model';
import { Transaction } from '../../models/transaction.model';
import { LoansService } from '../loans/loans.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

const PAST_MONTHS = 6;
const FUTURE_MONTHS = 5;
const AMOUNT_TOLERANCE_PCT = 0.05;
const AMOUNT_TOLERANCE_MIN = 0.5;

@Injectable()
export class ForecastService {
  constructor(
    private readonly declarations: DeclarationsService,
    private readonly storage: StorageService,
    private readonly loans: LoansService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async compute(): Promise<ForecastMonth[]> {
    const declarations = await this.declarations.getAll();
    const activeLoans = (await this.loans.getAll()).filter((l) => l.isActive);
    const activeSubs = (await this.subscriptions.getAll()).filter((s) => s.isActive);
    // Revenus récurrents Claude (Campbell Scientific…) — déjà filtrés des
    // déblocages crédit + dédupés via getAggregatedRecurringCredits.
    // Conserve uniquement les sources stables (salaire/pension/rental) en
    // fréquence régulière. 'irregular' et 'other' sont trop bruités.
    const allRecurringCredits = await this.storage.getAggregatedRecurringCredits();
    const recurringIncomes = allRecurringCredits.filter(
      (c) =>
        c.isActive
        && (c.category === 'salary' || c.category === 'pension' || c.category === 'rental')
        && (c.frequency === 'monthly' || c.frequency === 'bimonthly'),
    );
    const window = buildWindow(new Date(), PAST_MONTHS, FUTURE_MONTHS);
    const statements = await this.storage.getAllStatements();
    const txByMonth = indexTransactionsByMonth(statements);
    const consumed = new Set<string>();

    return window.map(({ year, month }) => {
      const monthKey = formatMonth(year, month);
      const occurrences: ForecastOccurrence[] = [];

      for (const decl of declarations) {
        if (!isActiveOn(decl, year, month)) continue;
        const signed = signedAmount(decl);
        const txs = txByMonth.get(monthKey) ?? [];
        const matchedTx = findMatch(decl, txs, consumed);
        if (matchedTx) consumed.add(matchedTx.id);
        occurrences.push({
          declarationId: decl.id,
          label: decl.label,
          type: decl.type,
          category: decl.category,
          amountSigned: signed,
          matched: !!matchedTx,
          matchedTxId: matchedTx?.id ?? null,
        });
      }

      // Active loans add a monthly expense within their start/end window.
      // Try to find a matching transaction in the month's actual statement.
      for (const loan of activeLoans) {
        if (loan.startDate && monthKey < loan.startDate.slice(0, 7)) continue;
        if (loan.endDate && monthKey > loan.endDate.slice(0, 7)) continue;
        const txs = txByMonth.get(monthKey) ?? [];
        const matchedTx = txs.find((t) => {
          if (consumed.has(t.id)) return false;
          if (Math.sign(t.amount) >= 0) return false;
          if (Math.abs(Math.abs(t.amount) - loan.monthlyPayment) > Math.max(loan.monthlyPayment * 0.05, 1)) return false;
          if (loan.contractRef && !t.description.toLowerCase().includes(loan.contractRef.toLowerCase())) return false;
          return true;
        });
        if (matchedTx) consumed.add(matchedTx.id);
        occurrences.push({
          declarationId: `loan:${loan.id}`,
          label: loan.name,
          type: 'loan',
          category: loan.category,
          amountSigned: -loan.monthlyPayment,
          matched: !!matchedTx,
          matchedTxId: matchedTx?.id ?? null,
        });
      }

      // Active subscriptions = monthly expenses within startDate window.
      for (const sub of activeSubs) {
        if (sub.startDate && monthKey < sub.startDate.slice(0, 7)) continue;
        const txs = txByMonth.get(monthKey) ?? [];
        let matchedTx: Transaction | null = null;
        if (sub.matchPattern) {
          try {
            const re = new RegExp(sub.matchPattern, 'i');
            matchedTx = txs.find((t) => {
              if (consumed.has(t.id)) return false;
              if (t.amount >= 0) return false;
              if (!re.test(t.description)) return false;
              if (Math.abs(Math.abs(t.amount) - sub.monthlyAmount) > Math.max(sub.monthlyAmount * 0.1, 1)) return false;
              return true;
            }) ?? null;
          } catch { /* invalid regex, skip */ }
        }
        if (matchedTx) consumed.add(matchedTx.id);
        occurrences.push({
          declarationId: `sub:${sub.id}`,
          label: sub.name,
          type: 'subscription',
          category: sub.category,
          amountSigned: -sub.monthlyAmount,
          matched: !!matchedTx,
          matchedTxId: matchedTx?.id ?? null,
        });
      }

      // Revenus récurrents détectés par Claude (salaire/pension/rental).
      for (const credit of recurringIncomes) {
        if (credit.firstSeenDate && monthKey < credit.firstSeenDate.slice(0, 7)) continue;
        const txs = txByMonth.get(monthKey) ?? [];
        const matchedTx = txs.find((t) => {
          if (consumed.has(t.id)) return false;
          if (t.amount <= 0) return false;
          if (Math.abs(t.amount - credit.monthlyAmount) > Math.max(credit.monthlyAmount * 0.15, 50)) return false;
          // Tente un match sur la description (mot-clé partagé)
          const cd = `${credit.description} ${credit.normalizedDescription}`.toLowerCase();
          const td = t.description.toLowerCase();
          const cdWords = cd.split(/\s+/).filter((w) => w.length >= 4);
          return cdWords.some((w) => td.includes(w));
        });
        if (matchedTx) consumed.add(matchedTx.id);
        occurrences.push({
          declarationId: `income:${credit.id}`,
          label: credit.description,
          type: 'income',
          category: credit.category,
          amountSigned: credit.monthlyAmount,
          matched: !!matchedTx,
          matchedTxId: matchedTx?.id ?? null,
        });
      }

      const income = sumWhere(occurrences, (o) => o.amountSigned > 0);
      const expense = -sumWhere(occurrences, (o) => o.amountSigned < 0);
      return { month: monthKey, income: round2(income), expense: round2(expense), net: round2(income - expense), occurrences };
    });
  }
}

function buildWindow(ref: Date, past: number, future: number): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  for (let i = -past; i <= future; i++) {
    const d = new Date(ref.getFullYear(), ref.getMonth() + i, 1);
    out.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  return out;
}

function formatMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function indexTransactionsByMonth(statements: MonthlyStatement[]): Map<string, Transaction[]> {
  const map = new Map<string, Transaction[]>();
  for (const s of statements) {
    const key = formatMonth(s.year, s.month);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(...s.transactions);
  }
  return map;
}

function isActiveOn(decl: Declaration, year: number, month: number): boolean {
  const target = year * 12 + (month - 1);
  const start = parseMonth(decl.startDate);
  const end = parseMonth(decl.endDate);
  if (start !== null && target < start) return false;
  if (end !== null && target > end) return false;

  switch (decl.periodicity) {
    case 'monthly':
      return true;
    case 'quarterly': {
      const anchor = start ?? target;
      return (target - anchor) % 3 === 0;
    }
    case 'yearly': {
      const anchorMonth = start !== null ? start % 12 : month - 1;
      return (month - 1) === anchorMonth;
    }
    case 'one-shot':
      return start !== null && target === start;
  }
}

function parseMonth(date: string | null): number | null {
  if (!date) return null;
  const m = date.match(/^(\d{4})-(0[1-9]|1[0-2])/);
  if (!m) return null;
  return parseInt(m[1], 10) * 12 + (parseInt(m[2], 10) - 1);
}

function signedAmount(decl: Declaration): number {
  const abs = Math.abs(decl.amount);
  return decl.type === 'income' ? abs : -abs;
}

function findMatch(decl: Declaration, txs: Transaction[], consumed: Set<string>): Transaction | null {
  const target = signedAmount(decl);
  const pattern = decl.matchPattern.toLowerCase();
  const tolerance = Math.max(Math.abs(target) * AMOUNT_TOLERANCE_PCT, AMOUNT_TOLERANCE_MIN);

  for (const tx of txs) {
    if (consumed.has(tx.id)) continue;
    if (Math.sign(tx.amount) !== Math.sign(target)) continue;
    if (Math.abs(tx.amount - target) > tolerance) continue;
    if (pattern) {
      const haystack = `${tx.description} ${tx.normalizedDescription}`.toLowerCase();
      if (!haystack.includes(pattern)) continue;
    }
    return tx;
  }
  return null;
}

function sumWhere(occs: ForecastOccurrence[], pred: (o: ForecastOccurrence) => boolean): number {
  return occs.filter(pred).reduce((s, o) => s + o.amountSigned, 0);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
