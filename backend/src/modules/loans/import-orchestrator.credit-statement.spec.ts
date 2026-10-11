import { ImportOrchestratorService } from './import-orchestrator.service';
import type { CreditStatementAnalysis } from '../analysis/credit-statement.service';

const extracted = (over: Partial<CreditStatementAnalysis>) =>
  ({
    documentType: 'credit_statement',
    creditor: 'COFIDIS',
    statementDate: '2026-03-15',
    monthlyPayment: 65.81,
    ...over,
  }) as CreditStatementAnalysis;

describe('ImportOrchestratorService — étapes communes des imports de relevé crédit (L14)', () => {
  const build = () => {
    const loans = { addOccurrence: jest.fn(async () => ({})) };
    return { svc: new ImportOrchestratorService(loans as any, {} as any), loans };
  };

  describe('rejectNonCreditDocument', () => {
    it('accepte un relevé de crédit', () => {
      const { svc } = build();
      expect(svc.rejectNonCreditDocument(extracted({}), 'single')).toBeNull();
      expect(svc.rejectNonCreditDocument(extracted({}), 'batch')).toBeNull();
    });

    it.each(['single', 'batch'] as const)('refuse un relevé bancaire (%s)', (mode) => {
      const { svc } = build();
      expect(svc.rejectNonCreditDocument(extracted({ documentType: 'bank_statement' }), mode)).toMatch(
        /relevé bancaire|pas un relevé de crédit/,
      );
    });

    it('refuse un document « other » dans les deux modes', () => {
      const { svc } = build();
      expect(svc.rejectNonCreditDocument(extracted({ documentType: 'other' }), 'single')).toBeTruthy();
      expect(svc.rejectNonCreditDocument(extracted({ documentType: 'other' }), 'batch')).toBeTruthy();
    });

    it("refuse un plan d'amortissement en single, l'accepte en batch (routé ailleurs)", () => {
      const { svc } = build();
      const plan = extracted({ documentType: 'amortization_plan' });
      expect(svc.rejectNonCreditDocument(plan, 'single')).toMatch(/plan d'amortissement/);
      expect(svc.rejectNonCreditDocument(plan, 'batch')).toBeNull();
    });
  });

  describe('addStatementOccurrence', () => {
    it("ajoute l'occurrence canonique du mois (source credit_statement, montant débit)", async () => {
      const { svc, loans } = build();
      await svc.addStatementOccurrence('loan-1', extracted({}));
      expect(loans.addOccurrence).toHaveBeenCalledWith('loan-1', {
        statementId: 'credit-loan-1-2026-03',
        date: '2026-03-15',
        amount: -65.81,
        transactionId: null,
        description: 'Relevé crédit COFIDIS 2026-03-15',
        source: 'credit_statement',
      });
    });

    it.each([
      ['sans date', { statementDate: undefined }],
      ['sans mensualité', { monthlyPayment: 0 }],
    ])('ne fait rien %s', async (_l, over) => {
      const { svc, loans } = build();
      await svc.addStatementOccurrence('loan-1', extracted(over as any));
      expect(loans.addOccurrence).not.toHaveBeenCalled();
    });
  });
});
