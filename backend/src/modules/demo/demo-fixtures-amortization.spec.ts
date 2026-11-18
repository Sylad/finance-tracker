import * as fs from 'fs';
import * as path from 'path';
import { shiftDemoFixtures } from './demo-date-shift';
import { computeLoanState } from '../loans/loans-state.helper';
import type { Loan } from '../../models/loan.model';

/**
 * L175 — la démo doit montrer le graphique « Tableau d'amortissement » des
 * cartes de crédit classique : au moins un crédit classique de la démo porte un
 * échéancier, et cet échéancier tient debout (capital restant décroissant
 * jusqu'à 0, somme des amortissements = capital emprunté). Données fictives.
 */
const cents = (x: number) => Math.round(x * 100);

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'demo-fixtures.json'), 'utf-8'));

function withSchedule(fixtures: { loans: Loan[] }): Loan[] {
  return fixtures.loans.filter(
    (l) => (l.kind ?? l.type) === 'classic' && (l.amortizationSchedule?.length ?? 0) > 0,
  );
}

describe.each([
  ['fixtures brutes', raw],
  ['fixtures recalées de 8 mois (L63)', shiftDemoFixtures(raw, 8)],
])('demo-fixtures — échéancier d’un crédit classique (L175), %s', (_label, fixtures) => {
  const loans = withSchedule(fixtures);

  it('au moins un crédit classique actif de la démo porte un échéancier', () => {
    expect(loans.filter((l) => l.isActive).length).toBeGreaterThanOrEqual(1);
  });

  it('capital restant strictement décroissant, jusqu’à 0 à la dernière échéance', () => {
    for (const l of loans) {
      const s = l.amortizationSchedule!;
      for (let i = 1; i < s.length; i++) {
        expect(s[i].capitalRemaining).toBeLessThan(s[i - 1].capitalRemaining);
      }
      expect(s[s.length - 1].capitalRemaining).toBe(0);
      expect(s.every((line) => line.capitalRemaining >= 0)).toBe(true);
    }
  });

  it('somme des amortissements = capital emprunté, et chaque ligne retire son amortissement', () => {
    for (const l of loans) {
      const s = l.amortizationSchedule!;
      expect(l.initialPrincipal).toBeGreaterThan(0);
      expect(s.reduce((sum, line) => sum + cents(line.capitalPaid), 0)).toBe(cents(l.initialPrincipal!));
      let remaining = cents(l.initialPrincipal!);
      for (const line of s) {
        remaining -= cents(line.capitalPaid);
        expect(cents(line.capitalRemaining)).toBe(remaining);
      }
    }
  });

  it('échéances mensuelles égales à la mensualité (dernière ≤), dates et durée alignées sur le crédit', () => {
    for (const l of loans) {
      const s = l.amortizationSchedule!;
      const months = s.map((line) => line.date.slice(0, 7));
      expect(new Set(months).size).toBe(s.length);
      for (let i = 1; i < months.length; i++) {
        const [py, pm] = months[i - 1].split('-').map(Number);
        const [y, m] = months[i].split('-').map(Number);
        expect(y * 12 + m - (py * 12 + pm)).toBe(1);
      }
      s.forEach((line, i) => {
        const total = cents(line.capitalPaid) + cents(line.interestPaid);
        if (i < s.length - 1) expect(total).toBe(cents(l.monthlyPayment));
        else expect(total).toBeLessThanOrEqual(cents(l.monthlyPayment));
        expect(line.interestPaid).toBeGreaterThanOrEqual(0);
      });
      expect(l.startDate! < s[0].date).toBe(true);
      expect(s[s.length - 1].date).toBe(l.endDate);
    }
  });

  it('chaque mensualité prélevée tombe sur une échéance, et le « réel » suit le « prévu » du graphique', () => {
    for (const l of loans) {
      const months = new Set(l.amortizationSchedule!.map((line) => line.date.slice(0, 7)));
      for (const o of l.occurrencesDetected) {
        expect(months.has(o.date.slice(0, 7))).toBe(true);
        // même calcul que la courbe « Réel (estimé) » du graphique, à la date de chaque échéance prélevée
        const line = l.amortizationSchedule!.find((x) => x.date.slice(0, 7) === o.date.slice(0, 7))!;
        expect(computeLoanState(l, line.date).capitalRemaining.gap).toBe(0);
      }
    }
  });
});
