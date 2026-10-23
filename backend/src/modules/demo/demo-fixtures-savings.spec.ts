import * as fs from 'fs';
import * as path from 'path';
import { shiftDemoFixtures } from './demo-date-shift';

/**
 * L122 — dans la démo, le solde courant d'un compte d'épargne est la somme de
 * ses mouvements ; l'ajustement au relevé porte exactement l'écart, et sa note
 * ne contredit pas son montant.
 */
describe('demo-fixtures — épargne (L122)', () => {
  const fixtures = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'demo-fixtures.json'), 'utf-8'),
  );
  const accounts: any[] = fixtures['savings-accounts'];

  it('R1 — le solde courant égale la somme des mouvements', () => {
    expect(accounts.length).toBeGreaterThanOrEqual(2);
    for (const a of accounts) {
      const sum = a.movements.reduce((s: number, m: any) => s + m.amount, 0);
      expect({ id: a.id, sum }).toEqual({ id: a.id, sum: a.currentBalance });
    }
  });

  it('R2 — l’ajustement au relevé égale le solde du relevé moins le solde calculé annoncé dans sa note', () => {
    for (const a of accounts) {
      for (const m of a.movements.filter((x: any) => x.source === 'bank-extract')) {
        const before = a.movements
          .filter((x: any) => x !== m)
          .reduce((s: number, x: any) => s + x.amount, 0);
        expect(before + m.amount).toBe(a.currentBalance);
        const cited = /(\d+)\s*vs\s*(\d+)\s*calcul/.exec(m.note ?? '');
        if (cited) {
          expect(Number(cited[1])).toBe(a.currentBalance);
          expect(Number(cited[2])).toBe(before);
        }
      }
    }
  });

  /**
   * L130 — sans intérêt sur un mois de 30 jours ni versement noté « Auto: Intérêts
   * créditeurs … », L126, L127 et L128 restaient inobservables en QA.
   */
  it('R3 — un intérêt tombe le dernier jour réel d’un mois de 30 jours, au taux du compte sur le solde de ce jour', () => {
    const interests = accounts.flatMap((a) =>
      a.movements.filter((m: any) => m.source === 'interest').map((m: any) => ({ a, m })),
    );
    const thirty = interests.filter(({ m }) => {
      const [y, mo, d] = m.date.split('-').map(Number);
      return d === 30 && new Date(Date.UTC(y, mo, 0)).getUTCDate() === 30;
    });
    expect(thirty.length).toBeGreaterThanOrEqual(1);
    for (const { a, m } of thirty) {
      const base = a.movements
        .filter((x: any) => x !== m && x.date <= m.date)
        .reduce((s: number, x: any) => s + x.amount, 0);
      expect(m.amount).toBe(Math.round(base * a.interestRate * 100) / 100);
      expect(m.note).toBe(`Intérêts ${m.date.slice(0, 4)} (${(a.interestRate * 100).toFixed(2)}%)`);
      expect(Number(m.date.slice(5, 7))).toBe(a.interestAnniversaryMonth);
    }
  });

  it('R4 — un versement détecté porte une note « Auto: Intérêts créditeurs … » et un montant positif', () => {
    const versements = accounts.flatMap((a) =>
      a.movements.filter((m: any) => m.source === 'detected' && /^Auto: Intérêts créditeurs /.test(m.note ?? '')),
    );
    expect(versements.length).toBeGreaterThanOrEqual(1);
    for (const m of versements) {
      expect(m.amount).toBeGreaterThan(0);
      expect(m.transactionId).toBeTruthy();
      expect(m.statementId).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it('R5 — après recalage de la démo, quel que soit le décalage, l’intérêt reste le dernier jour réel d’un mois de 30 jours', () => {
    for (let n = 0; n <= 24; n++) {
      const shifted = shiftDemoFixtures(fixtures, n) as typeof fixtures;
      const interests = shifted['savings-accounts'].flatMap((a: any) =>
        a.movements.filter((m: any) => m.source === 'interest'),
      );
      expect(interests.length).toBeGreaterThanOrEqual(1);
      for (const m of interests) {
        const [y, mo, d] = m.date.split('-').map(Number);
        expect({ n, date: m.date, jours: new Date(Date.UTC(y, mo, 0)).getUTCDate() }).toEqual({ n, date: m.date, jours: 30 });
        expect(d).toBe(30);
        expect(m.statementId).toBe(m.date.slice(0, 7));
      }
    }
  });
});
