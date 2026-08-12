import { Injectable } from '@nestjs/common';
import { MonthlyStatement } from '../../models/monthly-statement.model';
import { Loan } from '../../models/loan.model';
import { Subscription } from '../../models/subscription.model';
import { CandidateCluster, ClusterOccurrence } from '../../models/credit-detection.model';

const GENERIC_PREFIXES = ['achat cb', 'prélèvement', 'prelevement', 'paiement', 'virement'];
const MONTH_WORDS = /\b(janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre)\b/g;
const MIN_OCCURRENCES = 2;

@Injectable()
export class CandidateClusteringService {
  static collectKnownTxIds(loans: Loan[], subscriptions: Subscription[]): Set<string> {
    const ids = new Set<string>();
    for (const l of loans) for (const o of l.occurrencesDetected) if (o.transactionId) ids.add(o.transactionId);
    for (const s of subscriptions) for (const o of s.occurrencesDetected) if (o.transactionId) ids.add(o.transactionId);
    return ids;
  }

  buildClusters(statements: MonthlyStatement[], excludedTxIds: Set<string>): CandidateCluster[] {
    const byKey = new Map<string, { creditor: string; merchant: string | null; occ: ClusterOccurrence[] }>();
    for (const st of statements) {
      for (const t of st.transactions) {
        if (t.amount >= 0 || excludedTxIds.has(t.id)) continue;
        const parsed = this.parseCounterpart(t.description);
        if (!parsed) continue;
        const key = `${parsed.creditor}|${parsed.merchant ?? ''}`;
        const entry = byKey.get(key) ?? { creditor: parsed.creditor, merchant: parsed.merchant, occ: [] };
        entry.occ.push({ date: t.date, amount: t.amount, description: t.description, transactionId: t.id, statementId: st.id });
        byKey.set(key, entry);
      }
    }
    return [...byKey.entries()]
      .filter(([, v]) => v.occ.length >= MIN_OCCURRENCES)
      .map(([key, v]) => ({ key, creditor: v.creditor, merchant: v.merchant, occurrences: v.occ.sort((a, b) => a.date.localeCompare(b.date)) }));
  }

  private clean(part: string): string {
    return part.toLowerCase().replace(MONTH_WORDS, ' ').replace(/\d+/g, ' ')
      .replace(/[^a-zà-ÿ\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private parseCounterpart(description: string): { creditor: string; merchant: string | null } | null {
    let d = description.toLowerCase().trim();
    for (const p of GENERIC_PREFIXES) if (d.startsWith(p)) d = d.slice(p.length).trim();
    if (d.includes('*')) {
      const [left, right] = d.split('*', 2);
      const creditor = this.clean(left).split(' ')[0] ?? '';
      const merchant = this.clean(right).split(' ')[0] || null;
      return creditor ? { creditor, merchant } : null;
    }
    // No asterisk: only extract creditor, merchant stays null
    const tokens = d.split(/\s+/).filter(Boolean).filter(t => !/^\d+$/.test(t));
    if (tokens.length === 0) return null;
    return { creditor: tokens[0], merchant: null };
  }
}
