import { ImportOrchestratorService } from './import-orchestrator.service';
import type { Loan } from '../../models/loan.model';

describe('ImportOrchestratorService.retroMatchInstallment — paidOccurrenceId (L7)', () => {
  const mkLoan = (): Loan =>
    ({
      id: 'loan-1',
      creditor: 'COFIDIS',
      installmentMerchant: undefined,
      occurrencesDetected: [],
      installmentSchedule: [{ dueDate: '2025-11-02', amount: 65.81, paid: false }],
    }) as unknown as Loan;

  const build = (loan: Loan) => {
    const loans = {
      getAll: jest.fn(async () => [loan]),
      addOccurrence: jest.fn(async (_id: string, occ: any) => {
        loan.occurrencesDetected.push({ id: 'occ-uuid-1', ...occ });
        return loan;
      }),
      markInstallmentPaid: jest.fn(async () => loan),
    };
    const storage = {
      getAllStatements: jest.fn(async () => [
        {
          id: 'stmt-1',
          transactions: [
            { id: 'tx-1', date: '2025-11-09', amount: -65.81, description: 'PRLV COFIDIS' },
          ],
        },
      ]),
    };
    return { svc: new ImportOrchestratorService(loans as any, storage as any), loans };
  };

  it("passe l'UUID de l'occurrence créée à markInstallmentPaid, pas l'id de la transaction", async () => {
    const loan = mkLoan();
    const { svc, loans } = build(loan);
    await (svc as any).retroMatchInstallment(loan);
    expect(loans.markInstallmentPaid).toHaveBeenCalledWith('loan-1', 0, 'occ-uuid-1');
  });
});
