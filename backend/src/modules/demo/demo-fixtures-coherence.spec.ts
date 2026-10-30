import * as fs from 'fs';
import * as path from 'path';

/**
 * L73 — la démo doit raconter une histoire cohérente : pas de prêt immobilier
 * de 250 k€ sans actif en face (patrimoine net à −255 k€ pour 20 k€ d'épargne)
 * ni 70 % d'endettement pour un score du mois à 75/100.
 */
describe('demo-fixtures — cohérence patrimoine, endettement et score (L73)', () => {
  const fixtures = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'demo-fixtures.json'), 'utf-8'),
  );
  const loans: any[] = fixtures.loans;
  const statements: any[] = fixtures.statements;

  it('R1 — aucun crédit immobilier sans bien en face : pas de prêt d’un capital de 100 k€ ou plus, ni de catégorie mortgage', () => {
    for (const l of loans) {
      expect(l.category).not.toBe('mortgage');
      expect(l.initialPrincipal ?? 0).toBeLessThan(100_000);
    }
    for (const s of statements) {
      expect(s.transactions.filter((t: any) => t.subcategory === 'mortgage')).toEqual([]);
    }
  });

  it('R2 — les mensualités des crédits actifs pèsent entre 20 et 35 % du salaire', () => {
    const salary = statements[0].transactions.find((t: any) => t.subcategory === 'salary').amount;
    const monthly = loans.filter((l) => l.isActive).reduce((s, l) => s + l.monthlyPayment, 0);
    expect(monthly / salary).toBeGreaterThanOrEqual(0.2);
    expect(monthly / salary).toBeLessThanOrEqual(0.35);
  });

  it('R3 — le loyer remplace l’ancienne mensualité : même montant, catégorie housing/rent, jamais rattaché à un crédit', () => {
    for (const s of statements) {
      const rent = s.transactions.filter((t: any) => t.subcategory === 'rent');
      expect(rent).toHaveLength(1);
      expect(rent[0].amount).toBe(-1200);
      expect(rent[0].category).toBe('housing');
      expect(rent[0].description).not.toMatch(/IMMOBILIER|BNP/i);
    }
    const txIds = new Set(statements.flatMap((s) => s.transactions.map((t: any) => t.id)));
    for (const l of loans) {
      for (const o of l.occurrencesDetected ?? []) expect(txIds.has(o.transactionId)).toBe(true);
    }
  });

  it('R4 — aucun commentaire ne parle d’un crédit immobilier, d’un patrimoine négatif ni d’un endettement de 40 % ou plus', () => {
    const texts: string[] = [];
    for (const s of statements) {
      texts.push(s.analysisNarrative ?? '', s.healthScore?.claudeComment ?? '');
    }
    for (const t of texts) {
      expect(t).not.toMatch(/immobilier|patrimoine net reste négatif/i);
      for (const m of t.matchAll(/(\d+)\s*%/g)) {
        if (/endettement|remboursements/i.test(t)) expect(Number(m[1])).toBeLessThan(40);
      }
    }
  });

  it('R5 — le relevé reste équilibré : ouverture + crédits − débits = clôture', () => {
    for (const s of statements) {
      const r = (n: number) => Math.round(n * 100);
      expect(r(s.openingBalance + s.totalCredits - s.totalDebits)).toBe(r(s.closingBalance));
    }
  });
});
