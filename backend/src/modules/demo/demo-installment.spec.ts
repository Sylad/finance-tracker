import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { buildDemoInstallmentLoan } from './demo-installment';
import { DemoSeedService } from './demo-seed.service';
import { RequestDataDirService } from './request-data-dir.service';
import { Loan } from '../../models/loan.model';
import { LoansService } from '../loans/loans.service';

/**
 * L146 — la démo porte un paiement en plusieurs fois ACTIF, signature et
 * échéances recalées sur la date du jour, pour que la carte N× de /loans
 * (dates fr-FR) s'observe en QA.
 */
describe('démo — paiement en plusieurs fois actif (L146)', () => {
  const NOW = new Date('2026-10-23T10:00:00Z');

  it('R1 — c’est un paiement échelonné actif (kind installment, isActive)', () => {
    const loan = buildDemoInstallmentLoan(NOW);
    expect(loan).toMatchObject({ kind: 'installment', isActive: true });
    expect(loan.installmentSchedule).toHaveLength(4);
    expect(loan.monthlyPayment).toBe(loan.installmentSchedule![0].amount);
  });

  it('R2 — la signature date d’un mois avant aujourd’hui et les échéances se suivent chaque mois', () => {
    const loan = buildDemoInstallmentLoan(NOW);
    expect(loan.installmentSignatureDate).toBe('2026-09-23');
    expect(loan.installmentSchedule!.map((l) => l.dueDate)).toEqual(['2026-09-23', '2026-10-23', '2026-11-23', '2026-12-23']);
  });

  it('R3 — le jour est ramené dans le mois (31 → 28 février) et passe l’année', () => {
    const loan = buildDemoInstallmentLoan(new Date('2026-12-31T10:00:00Z'));
    expect(loan.installmentSchedule!.map((l) => l.dueDate)).toEqual(['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28']);
  });

  it('R5 (L148) — le jour même, la deuxième échéance n’est pas échue : la démo n’est plus en « Partiel »', () => {
    const loan = buildDemoInstallmentLoan(NOW);
    expect(LoansService.getLoanHealth(loan, '2026-10-23')).toBe('complete');
  });

  it('R4 — la première échéance est payée, les suivantes ne sont pas en retard', () => {
    const today = NOW.toISOString().slice(0, 10);
    const [first, ...rest] = buildDemoInstallmentLoan(NOW).installmentSchedule!;
    expect(first.paid).toBe(true);
    expect(rest.every((l) => !l.paid && l.dueDate >= today)).toBe(true);
  });

  it('R5 — le seed écrit ce paiement actif dans loans.json, recalé sur le jour', async () => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'setTimeout'] });
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-installment-spec-'));
    try {
      const config = { get: (k: string) => (k === 'dataDir' ? base : undefined) } as unknown as ConfigService;
      await new DemoSeedService(config, {} as RequestDataDirService).seed();
      const loans = JSON.parse(fs.readFileSync(path.join(base, 'demo', 'loans.json'), 'utf8')) as Loan[];
      const active = loans.filter((l) => l.kind === 'installment' && l.isActive);
      expect(active).toHaveLength(1);
      expect(active[0].installmentSchedule![1].dueDate).toBe('2026-10-23');
    } finally {
      jest.useRealTimers();
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('R6 — une démo déjà amorcée voit ses échéances recalées au démarrage suivant, sans autre rattrapage', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-installment-spec-'));
    try {
      const config = { get: (k: string) => (k === 'dataDir' ? base : undefined) } as unknown as ConfigService;
      const service = new DemoSeedService(config, {} as RequestDataDirService);
      jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'setTimeout'] });
      await service.seed();
      jest.setSystemTime(new Date('2026-10-24T10:00:00Z'));
      await service.seed();
      const loans = JSON.parse(fs.readFileSync(path.join(base, 'demo', 'loans.json'), 'utf8')) as Loan[];
      const installments = loans.filter((l) => l.kind === 'installment');
      expect(installments).toHaveLength(1);
      expect(installments[0].installmentSignatureDate).toBe('2026-09-24');
    } finally {
      jest.useRealTimers();
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
