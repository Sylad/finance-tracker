import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { attachDemoInstallmentDebit, buildDemoInstallmentLoan } from './demo-installment';
import { DemoSeedService } from './demo-seed.service';
import { RequestDataDirService } from './request-data-dir.service';
import { Loan } from '../../models/loan.model';
import { MonthlyStatement } from '../../models/monthly-statement.model';

/**
 * L150 — l'échéance 1 du ALMA 4X de la démo est marquée payée : le relevé du
 * mois de cette échéance doit porter le débit ALMA, sinon le graphique « Charge
 * crédits » n'a rien en septembre.
 */
describe('démo — débit de l’échéance 1 du paiement en plusieurs fois (L150)', () => {
  const NOW = new Date('2026-10-23T10:00:00Z');
  let base: string;
  let service: DemoSeedService;
  const demoFile = (...p: string[]) => path.join(base, 'demo', ...p);
  const loan = () =>
    (JSON.parse(fs.readFileSync(demoFile('loans.json'), 'utf8')) as Loan[]).find((l) => l.kind === 'installment')!;
  const statement = (id: string) =>
    JSON.parse(fs.readFileSync(demoFile('statements', `${id}.json`), 'utf8')) as MonthlyStatement;
  const almaDebits = (s: MonthlyStatement) => s.transactions.filter((t) => /ALMA/.test(t.description));

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-installment-debit-'));
    const config = { get: (k: string) => (k === 'dataDir' ? base : undefined) } as unknown as ConfigService;
    service = new DemoSeedService(config, {} as RequestDataDirService);
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'setTimeout'] });
  });
  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('R1 — le relevé du mois de l’échéance 1 porte un débit ALMA du montant et de la date de l’échéance', async () => {
    await service.seed();
    const first = loan().installmentSchedule![0];
    const debits = almaDebits(statement(first.dueDate.slice(0, 7)));
    expect(debits).toHaveLength(1);
    expect(debits[0]).toMatchObject({ date: first.dueDate, amount: -first.amount });
  });

  it('R2 — l’échéance 1 payée pointe une occurrence de ce débit, comptée dans la charge du mois', async () => {
    await service.seed();
    const l = loan();
    const first = l.installmentSchedule![0];
    const month = first.dueDate.slice(0, 7);
    const occ = l.occurrencesDetected.find((o) => o.id === first.paidOccurrenceId)!;
    expect(first.paid).toBe(true);
    expect(occ).toMatchObject({ statementId: month, date: first.dueDate, amount: -first.amount, source: 'bank_statement' });
    expect(occ.transactionId).toBe(almaDebits(statement(month))[0].id);
    expect(l.occurrencesDetected.filter((o) => o.date.slice(0, 7) === month)).toHaveLength(1);
  });

  it('R3 — le relevé reste équilibré : ouverture + crédits − débits = clôture', async () => {
    await service.seed();
    const s = statement(loan().installmentSchedule![0].dueDate.slice(0, 7));
    expect(Math.round((s.openingBalance + s.totalCredits - s.totalDebits) * 100)).toBe(Math.round(s.closingBalance * 100));
    const sum = (f: (a: number) => boolean) =>
      s.transactions.filter((t) => f(t.amount)).reduce((a, t) => a + Math.abs(t.amount), 0);
    expect(s.totalDebits).toBeCloseTo(sum((a) => a < 0), 2);
  });

  it('R4 — le recalage du lendemain déplace le débit avec l’échéance, sans le doubler ni toucher aux totaux', async () => {
    await service.seed();
    const month = loan().installmentSchedule![0].dueDate.slice(0, 7);
    const before = statement(month);
    jest.setSystemTime(new Date('2026-10-24T10:00:00Z'));
    await service.seed();
    const after = statement(month);
    const debits = almaDebits(after);
    expect(debits).toHaveLength(1);
    expect(debits[0].date).toBe('2026-09-24');
    expect(loan().occurrencesDetected[0].date).toBe('2026-09-24');
    expect(after.totalDebits).toBe(before.totalDebits);
    expect(after.closingBalance).toBe(before.closingBalance);
  });

  it('R5 — sans relevé pour le mois de l’échéance 1, elle n’est pas déclarée payée', () => {
    const { statements, loan: l } = attachDemoInstallmentDebit([], buildDemoInstallmentLoan(NOW));
    expect(statements).toEqual([]);
    expect(l.installmentSchedule![0].paid).toBe(false);
    expect(l.occurrencesDetected).toEqual([]);
  });
});
