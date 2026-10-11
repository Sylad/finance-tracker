import { monthsToShift, shiftDemoFixtures } from './demo-date-shift';

/**
 * L63 — les fixtures s'arrêtent en mars 2026 ; au chargement, la démo est
 * recalée pour que son dernier relevé soit le mois précédant la date du jour.
 */
describe('demo-date-shift (L63)', () => {
  describe('monthsToShift', () => {
    it('0 quand le dernier relevé est déjà le mois précédent', () => {
      expect(monthsToShift(2026, 3, new Date('2026-04-15T10:00:00Z'))).toBe(0);
    });
    it('compte les mois jusqu’au mois précédant aujourd’hui', () => {
      expect(monthsToShift(2026, 3, new Date('2026-10-11T10:00:00Z'))).toBe(6);
    });
    it('passe le changement d’année', () => {
      expect(monthsToShift(2026, 3, new Date('2027-01-02T10:00:00Z'))).toBe(9);
    });
    it('ne recule jamais', () => {
      expect(monthsToShift(2026, 3, new Date('2026-01-02T10:00:00Z'))).toBe(0);
    });
  });

  describe('shiftDemoFixtures', () => {
    const base = () => ({
      statements: [
        {
          id: '2026-03', year: 2026, month: 3, uploadedAt: '2026-04-09T10:00:00Z',
          transactions: [{ id: 'demo-tx-2026-03-001', date: '2026-03-31', description: 'N° 20260331' }],
        },
        { id: '2026-01', year: 2026, month: 1, transactions: [{ id: 'demo-tx-2026-01-001', date: '2026-01-31' }] },
      ],
      loans: [{ startDate: '2024-09-03', endDate: '2026-09-03', occurrencesDetected: [{ id: 'occ-x-2026-03', statementId: '2026-03', date: '2026-03-05' }] }],
      'import-logs': [{ filename: 'releve_LBP_demo_20260309.pdf', statementMonth: 3, statementYear: 2026 }],
    });

    it('ne change rien à 0 mois', () => {
      expect(shiftDemoFixtures(base(), 0)).toEqual(base());
    });

    it('décale dates, identifiants, mois/année et nom de fichier', () => {
      const f = shiftDemoFixtures(base(), 6) as ReturnType<typeof base>;
      expect(f.statements[0]).toMatchObject({ id: '2026-09', year: 2026, month: 9, uploadedAt: '2026-10-09T10:00:00Z' });
      expect(f.statements[0].transactions[0]).toEqual({ id: 'demo-tx-2026-09-001', date: '2026-09-30', description: 'N° 20260331' });
      expect(f.statements[1]).toMatchObject({ id: '2026-07', month: 7 });
      expect(f.statements[1].transactions[0].date).toBe('2026-07-31');
      expect(f.loans[0]).toMatchObject({ startDate: '2025-03-03', endDate: '2027-03-03' });
      expect(f.loans[0].occurrencesDetected[0]).toEqual({ id: 'occ-x-2026-09', statementId: '2026-09', date: '2026-09-05' });
      expect(f['import-logs'][0]).toEqual({ filename: 'releve_LBP_demo_20260909.pdf', statementMonth: 9, statementYear: 2026 });
    });

    it('passe l’année et ramène le jour dans le mois', () => {
      const f = shiftDemoFixtures(base(), 11) as ReturnType<typeof base>;
      expect(f.statements[0]).toMatchObject({ id: '2027-02', year: 2027, month: 2 });
      expect(f.statements[0].transactions[0].date).toBe('2027-02-28');
    });

    it('ne modifie pas l’entrée', () => {
      const input = base();
      shiftDemoFixtures(input, 6);
      expect(input).toEqual(base());
    });
  });
});
