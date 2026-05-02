import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LoansService } from './loans.service';
import { EventBusService } from '../events/event-bus.service';
import { RequestDataDirService } from '../demo/request-data-dir.service';

describe('LoansService', () => {
  let svc: LoansService;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-loans-'));
    const mod = await Test.createTestingModule({
      providers: [
        LoansService,
        { provide: RequestDataDirService, useValue: { getDataDir: () => tmpDir, isDemoMode: () => false, runWith: (_ctx: any, fn: any) => fn() } },
        { provide: EventBusService, useValue: { emit: jest.fn() } },
      ],
    }).compile();
    svc = mod.get(LoansService);
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('starts empty', async () => {
    expect(await svc.getAll()).toEqual([]);
  });

  it('creates a classic loan', async () => {
    const loan = await svc.create({
      name: 'Crédit auto',
      type: 'classic',
      category: 'auto',
      monthlyPayment: 240,
      matchPattern: 'PRELEVT.*BANQUE',
      isActive: true,
      startDate: '2025-01-01',
      endDate: '2028-01-01',
    });
    expect(loan.id).toBeDefined();
    expect(loan.type).toBe('classic');
    expect(loan.occurrencesDetected).toEqual([]);
  });

  it('creates a revolving loan', async () => {
    const loan = await svc.create({
      name: 'Carte magasin',
      type: 'revolving',
      category: 'consumer',
      monthlyPayment: 80,
      matchPattern: 'COFIDIS',
      isActive: true,
      maxAmount: 3000,
      usedAmount: 1200,
    });
    expect(loan.maxAmount).toBe(3000);
    expect(loan.usedAmount).toBe(1200);
  });

  it('addOccurrence is idempotent on (statementId, transactionId)', async () => {
    const loan = await svc.create({
      name: 'Test',
      type: 'classic',
      category: 'consumer',
      monthlyPayment: 100,
      matchPattern: 'TEST',
      isActive: true,
    });
    await svc.addOccurrence(loan.id, { statementId: '2026-03', date: '2026-03-15', amount: -100, transactionId: 'tx-1' });
    await svc.addOccurrence(loan.id, { statementId: '2026-03', date: '2026-03-15', amount: -100, transactionId: 'tx-1' });
    const reloaded = await svc.getOne(loan.id);
    expect(reloaded.occurrencesDetected).toHaveLength(1);
  });

  it('addOccurrence on revolving decrements usedAmount', async () => {
    const loan = await svc.create({
      name: 'Carte',
      type: 'revolving',
      category: 'consumer',
      monthlyPayment: 80,
      matchPattern: 'C',
      isActive: true,
      maxAmount: 3000,
      usedAmount: 1200,
    });
    await svc.addOccurrence(loan.id, { statementId: '2026-03', date: '2026-03-15', amount: -80, transactionId: 'tx-1' });
    const reloaded = await svc.getOne(loan.id);
    expect(reloaded.usedAmount).toBe(1120);
  });

  it('resetRevolving updates usedAmount and lastManualResetAt', async () => {
    const loan = await svc.create({
      name: 'Carte',
      type: 'revolving',
      category: 'consumer',
      monthlyPayment: 80,
      matchPattern: 'C',
      isActive: true,
      maxAmount: 3000,
      usedAmount: 1200,
    });
    const updated = await svc.resetRevolving(loan.id, 800);
    expect(updated.usedAmount).toBe(800);
    expect(updated.lastManualResetAt).toBeDefined();
  });
});
