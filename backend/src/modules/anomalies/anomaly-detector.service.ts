import { Injectable } from '@nestjs/common';
import { MonthlyStatement } from '../../models/monthly-statement.model';
import { Transaction } from '../../models/transaction.model';

export type AnomalySeverity = 'info' | 'warning' | 'critical';
export type AnomalyType = 'duplicate' | 'bank_fee_spike' | 'large_outlier' | 'new_recurring';

export interface Anomaly {
  type: AnomalyType;
  severity: AnomalySeverity;
  title: string;
  detail: string;
  transactionIds: string[];
}

const BANK_FEE_PATTERNS = [
  /\bFRAIS\b/i,
  /\bCOMMISSION\b/i,
  /\bAGIO\b/i,
  /\bINTERET[S]?\s+DEBITEUR/i,
  /\bCOTISATION\s+CARTE/i,
  /\bDECOUVERT\b/i,
];

const SOFT_DUPLICATE_DAY_WINDOW = 1;

@Injectable()
export class AnomalyDetectorService {
  /**
   * Inspect a statement and return everything that "looks weird".
   * Pure function — same input always yields the same output.
   *
   * `prevStatement` (optional) is used to compare bank-fee volume
   * against the previous month and surface a "spike" alert.
   */
  detect(statement: MonthlyStatement, prevStatement?: MonthlyStatement | null): Anomaly[] {
    return [
      ...this.findDuplicates(statement),
      ...this.findBankFees(statement, prevStatement ?? null),
      ...this.findLargeOutliers(statement),
    ];
  }

  /**
   * Two debits are flagged as a likely duplicate when they share:
   *   - the exact same amount
   *   - the same normalized description (or, if either is empty, the same description)
   *   - dates within ±1 day
   *
   * Returns one Anomaly per detected pair.
   */
  private findDuplicates(statement: MonthlyStatement): Anomaly[] {
    const debits = statement.transactions.filter((t) => t.amount < 0);
    const seen = new Map<string, Transaction>();
    const anomalies: Anomaly[] = [];
    for (const t of debits) {
      const key = `${t.amount}|${(t.normalizedDescription || t.description).toLowerCase().trim()}`;
      const prior = seen.get(key);
      if (prior) {
        const daysApart = Math.abs(daysBetween(prior.date, t.date));
        if (daysApart <= SOFT_DUPLICATE_DAY_WINDOW) {
          anomalies.push({
            type: 'duplicate',
            severity: 'warning',
            title: 'Doublon potentiel',
            detail: `${t.description} : 2 prélèvements identiques (${formatEUR(Math.abs(t.amount))}) à ${daysApart} jour(s) d'intervalle.`,
            transactionIds: [prior.id, t.id],
          });
        }
      } else {
        seen.set(key, t);
      }
    }
    return anomalies;
  }

  /**
   * Surface bank-fee transactions, and flag a "spike" if the total
   * fee amount is at least 50 % higher than the previous month.
   * If there is no previous month, fees are surfaced as info-level
   * (informational only, not an alert).
   */
  private findBankFees(statement: MonthlyStatement, prev: MonthlyStatement | null): Anomaly[] {
    const fees = statement.transactions.filter(
      (t) => t.amount < 0 && BANK_FEE_PATTERNS.some((p) => p.test(t.description)),
    );
    if (fees.length === 0) return [];
    const totalNow = fees.reduce((s, t) => s + Math.abs(t.amount), 0);

    let severity: AnomalySeverity = 'info';
    let detail = `${fees.length} prélèvement(s) de frais bancaires ce mois (${formatEUR(totalNow)}).`;

    if (prev) {
      const prevFees = prev.transactions.filter(
        (t) => t.amount < 0 && BANK_FEE_PATTERNS.some((p) => p.test(t.description)),
      );
      const totalPrev = prevFees.reduce((s, t) => s + Math.abs(t.amount), 0);
      if (totalPrev > 0 && totalNow >= totalPrev * 1.5) {
        severity = 'warning';
        const pct = Math.round(((totalNow - totalPrev) / totalPrev) * 100);
        detail = `Frais bancaires en hausse de +${pct}% (${formatEUR(totalNow)} ce mois vs ${formatEUR(totalPrev)} le mois dernier).`;
      } else if (totalPrev === 0 && totalNow > 0) {
        severity = 'warning';
        detail = `${fees.length} frais bancaire(s) (${formatEUR(totalNow)}) — aucun le mois dernier.`;
      }
    }

    return [
      {
        type: 'bank_fee_spike',
        severity,
        title: severity === 'info' ? 'Frais bancaires' : 'Frais bancaires en hausse',
        detail,
        transactionIds: fees.map((t) => t.id),
      },
    ];
  }

  /**
   * A debit is "large" when:
   *   - amount > 200 €
   *   - amount >= 3 × the median absolute debit of the month
   *   - it's NOT recurring (recurring big tx = mortgage, expected)
   * Returns one Anomaly per outlier transaction.
   */
  private findLargeOutliers(statement: MonthlyStatement): Anomaly[] {
    const debits = statement.transactions.filter((t) => t.amount < 0);
    if (debits.length < 5) return [];
    const sortedAbs = debits.map((t) => Math.abs(t.amount)).sort((a, b) => a - b);
    const median = sortedAbs[Math.floor(sortedAbs.length / 2)];
    if (median <= 0) return [];
    return debits
      .filter((t) => Math.abs(t.amount) > 200 && Math.abs(t.amount) >= 3 * median && !t.isRecurring)
      .map((t) => ({
        type: 'large_outlier' as AnomalyType,
        severity: 'info' as AnomalySeverity,
        title: 'Gros débit ponctuel',
        detail: `${t.description} : ${formatEUR(Math.abs(t.amount))}, soit ~${Math.round(Math.abs(t.amount) / median)}× la dépense médiane du mois.`,
        transactionIds: [t.id],
      }));
  }
}

function daysBetween(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (isNaN(ta) || isNaN(tb)) return Number.MAX_SAFE_INTEGER;
  return (tb - ta) / 86400000;
}

function formatEUR(n: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
}
