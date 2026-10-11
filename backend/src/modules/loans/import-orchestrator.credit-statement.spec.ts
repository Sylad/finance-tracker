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

    const SINGLE_NON_CREDIT =
      "Ce PDF n'est pas un relevé de crédit — importe les relevés bancaires depuis la page Import.";

    it('refuse un relevé bancaire avec le message propre à chaque mode', () => {
      const { svc } = build();
      const bank = extracted({ documentType: 'bank_statement' });
      expect(svc.rejectNonCreditDocument(bank, 'single')).toBe(SINGLE_NON_CREDIT);
      expect(svc.rejectNonCreditDocument(bank, 'batch')).toBe(
        'Ce PDF est un relevé bancaire — importe-le depuis la page Import (relevés bancaires).',
      );
    });

    it('refuse un document « other » avec le message propre à chaque mode', () => {
      const { svc } = build();
      const other = extracted({ documentType: 'other' });
      expect(svc.rejectNonCreditDocument(other, 'single')).toBe(SINGLE_NON_CREDIT);
      expect(svc.rejectNonCreditDocument(other, 'batch')).toBe(
        "Ce PDF ne ressemble ni à un relevé de crédit, ni à un plan d'amortissement.",
      );
    });

    it("refuse un plan d'amortissement en single, l'accepte en batch (routé ailleurs)", () => {
      const { svc } = build();
      const plan = extracted({ documentType: 'amortization_plan' });
      expect(svc.rejectNonCreditDocument(plan, 'single')).toBe(
        "Ce PDF est un plan d'amortissement — utilise le bouton « Importer PDF crédits » (il le route automatiquement).",
      );
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
