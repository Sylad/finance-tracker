import { CandidateClusteringService } from './candidate-clustering.service';
import { MonthlyStatement } from '../../models/monthly-statement.model';

const tx = (id: string, date: string, description: string, amount: number) => ({
  id, date, description, normalizedDescription: description.toLowerCase(),
  amount, currency: 'EUR', category: 'shopping', subcategory: '', isRecurring: false, confidence: 1,
});
const stmt = (id: string, month: number, txs: ReturnType<typeof tx>[]): MonthlyStatement => ({
  id, month, year: 2026, uploadedAt: '', bankName: 'X', accountHolder: 'Demo', currency: 'EUR',
  openingBalance: 0, closingBalance: 0, totalCredits: 0, totalDebits: 0, transactions: txs,
  healthScore: { total: 50, breakdown: { savingsRate: 50, expenseControl: 50, debtBurden: 50, cashFlowBalance: 50, irregularSpending: 50 }, trend: 'insufficient_data', claudeComment: '' },
  recurringCredits: [], analysisNarrative: '', externalAccountBalances: [],
});

describe('CandidateClusteringService', () => {
  const svc = new CandidateClusteringService();

  it('groupe une série N× par creditor|merchant, extrait le split sur *', () => {
    const clusters = svc.buildClusters([stmt('2026-01', 1, [
      tx('a', '2026-01-10', 'Achat CB Klarni*Zoland 4X', -44.98),
      tx('b', '2026-02-10', 'Klarni*Zoland', -44.98),
      tx('c', '2026-01-15', 'COURSES SUPERETTE', -60),
    ])], new Set());
    expect(clusters).toHaveLength(1);
    expect(clusters[0].creditor).toBe('klarni');
    expect(clusters[0].merchant).toBe('zoland');
    expect(clusters[0].occurrences.map((o) => o.transactionId)).toEqual(['a', 'b']);
  });

  it('exclut les crédits (amount > 0) et les tx déjà connues (excludedTxIds)', () => {
    const clusters = svc.buildClusters([stmt('2026-01', 1, [
      tx('a', '2026-01-10', 'PayFriend *Paieme', -48.18),
      tx('b', '2026-02-10', 'PayFriend *Paieme', -48.18),
      tx('in', '2026-01-12', 'PayFriend *Paieme', 48.18),
    ])], new Set(['b']));
    expect(clusters).toHaveLength(0); // il ne reste qu'une occurrence → < 2
  });

  it('un débit isolé ne forme pas de cluster', () => {
    const clusters = svc.buildClusters([stmt('2026-01', 1, [
      tx('a', '2026-01-10', 'Achat CB Almi', -91),
    ])], new Set());
    expect(clusters).toHaveLength(0);
  });

  it('sans étoile : creditor = 1er token utile après retrait des préfixes génériques', () => {
    const clusters = svc.buildClusters([stmt('2026-01', 1, [
      tx('a', '2026-01-10', 'Prélèvement Almi 3 fois', -91),
      tx('b', '2026-02-12', 'Achat CB Almi', -91.5),
    ])], new Set());
    expect(clusters).toHaveLength(1);
    expect(clusters[0].creditor).toBe('almi');
    expect(clusters[0].occurrences).toHaveLength(2);
  });
});
