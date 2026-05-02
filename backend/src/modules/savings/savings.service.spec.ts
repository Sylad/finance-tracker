import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SavingsService } from './savings.service';
import { EventBusService } from '../events/event-bus.service';
import { RequestDataDirService } from '../demo/request-data-dir.service';

describe('SavingsService', () => {
  let svc: SavingsService;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-savings-'));
    const mod = await Test.createTestingModule({
      providers: [
        SavingsService,
        { provide: RequestDataDirService, useValue: { getDataDir: () => tmpDir, isDemoMode: () => false, runWith: (_ctx: any, fn: any) => fn() } },
        { provide: EventBusService, useValue: { emit: jest.fn() } },
      ],
    }).compile();
    svc = mod.get(SavingsService);
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('starts with empty list', async () => {
    expect(await svc.getAll()).toEqual([]);
  });

  it('creates a savings account with initial balance movement', async () => {
    const acc = await svc.create({
      name: 'Livret A',
      type: 'livret-a',
      initialBalance: 201.55,
      initialBalanceDate: '2026-05-01',
      matchPattern: 'VIR.*LIVRET',
      interestRate: 0.015,
      interestAnniversaryMonth: 12,
    });
    expect(acc.id).toBeDefined();
    expect(acc.currentBalance).toBe(201.55);
    expect(acc.movements).toHaveLength(1);
    expect(acc.movements[0].source).toBe('initial');
    expect(acc.movements[0].amount).toBe(201.55);
  });

  it('addMovement updates currentBalance and history', async () => {
    const acc = await svc.create({
      name: 'PEL',
      type: 'pel',
      initialBalance: 1000,
      initialBalanceDate: '2026-01-01',
      matchPattern: 'VIR.*PEL',
      interestRate: 0.02,
      interestAnniversaryMonth: 6,
    });
    const updated = await svc.addMovement(acc.id, {
      date: '2026-02-15',
      amount: 100,
      source: 'detected',
      statementId: '2026-02',
      transactionId: 'tx-1',
    });
    expect(updated.currentBalance).toBe(1100);
    expect(updated.movements).toHaveLength(2);
  });

  it('balanceHistory reflects movements over months', async () => {
    const acc = await svc.create({
      name: 'PEL',
      type: 'pel',
      initialBalance: 0,
      initialBalanceDate: '2026-01-01',
      matchPattern: '',
      interestRate: 0.02,
      interestAnniversaryMonth: 6,
    });
    await svc.addMovement(acc.id, { date: '2026-01-15', amount: 100, source: 'detected' });
    await svc.addMovement(acc.id, { date: '2026-03-15', amount: 200, source: 'detected' });
    const hist = await svc.getBalanceHistory(acc.id, 12);
    expect(hist).toHaveLength(12);
    const jan = hist.find((h) => h.month === '2026-01');
    const feb = hist.find((h) => h.month === '2026-02');
    const mar = hist.find((h) => h.month === '2026-03');
    expect(jan!.balance).toBe(100);
    expect(feb!.balance).toBe(100);
    expect(mar!.balance).toBe(300);
  });
});
