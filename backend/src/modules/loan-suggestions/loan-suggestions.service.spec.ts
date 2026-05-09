import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LoanSuggestionsService } from './loan-suggestions.service';
import { EventBusService } from '../events/event-bus.service';
import { RequestDataDirService } from '../demo/request-data-dir.service';

describe('LoanSuggestionsService', () => {
  let svc: LoanSuggestionsService;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-sugg-'));
    const mod = await Test.createTestingModule({
      providers: [
        LoanSuggestionsService,
        { provide: RequestDataDirService, useValue: { getDataDir: () => tmpDir, isDemoMode: () => false, runWith: (_ctx: any, fn: any) => fn() } },
        { provide: EventBusService, useValue: { emit: jest.fn() } },
      ],
    }).compile();
    svc = mod.get(LoanSuggestionsService);
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('upserts a new pending suggestion', async () => {
    await svc.upsertMany('2026-03', [{
      label: 'PRELEVT CETELEM',
      monthlyAmount: 320,
      occurrencesSeen: 5,
      firstSeenDate: '2025-11-15',
      suggestedType: 'loan',
      matchPattern: 'PRELEVT.*CETELEM',
    }]);
    const all = await svc.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe('pending');
    expect(all[0].occurrencesSeen).toBe(5);
  });

  it('deduplicates by matchPattern (incrementing occurrencesSeen)', async () => {
    const incoming = {
      label: 'PRELEVT CETELEM',
      monthlyAmount: 320,
      occurrencesSeen: 5,
      firstSeenDate: '2025-11-15',
      suggestedType: 'loan' as const,
      matchPattern: 'PRELEVT.*CETELEM',
    };
    await svc.upsertMany('2026-03', [incoming]);
    await svc.upsertMany('2026-04', [{ ...incoming, occurrencesSeen: 6, firstSeenDate: '2026-04-01' }]);
    const all = await svc.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].occurrencesSeen).toBe(6);
    expect(all[0].lastSeenDate).toBe('2026-04-01');
  });

  it('does not resurrect rejected suggestions', async () => {
    const incoming = {
      label: 'X', monthlyAmount: 10, occurrencesSeen: 3, firstSeenDate: '2025-11-01',
      suggestedType: 'loan' as const, matchPattern: 'X',
    };
    await svc.upsertMany('2026-03', [incoming]);
    const [s] = await svc.getAll();
    await svc.reject(s.id);
    await svc.upsertMany('2026-04', [incoming]);
    const all = await svc.getAll();
    expect(all.find((x) => x.id === s.id)?.status).toBe('rejected');
  });

  it('accept marks resolvedAt and stores acceptedAsLoanId', async () => {
    await svc.upsertMany('2026-03', [{
      label: 'Y', monthlyAmount: 50, occurrencesSeen: 4, firstSeenDate: '2025-11-01',
      suggestedType: 'loan', matchPattern: 'Y',
    }]);
    const [s] = await svc.getAll();
    const updated = await svc.accept(s.id, { loanId: 'loan-123' });
    expect(updated.status).toBe('accepted');
    expect(updated.acceptedAsLoanId).toBe('loan-123');
    expect(updated.resolvedAt).toBeDefined();
  });

  it('accept routes a subscription suggestion to acceptedAsSubscriptionId', async () => {
    await svc.upsertMany('2026-03', [{
      label: 'NETFLIX', monthlyAmount: 17.99, occurrencesSeen: 4, firstSeenDate: '2025-11-01',
      suggestedType: 'subscription', matchPattern: 'NETFLIX',
    }]);
    const [s] = await svc.getAll();
    const updated = await svc.accept(s.id, { subscriptionId: 'sub-456' });
    expect(updated.status).toBe('accepted');
    expect(updated.acceptedAsSubscriptionId).toBe('sub-456');
    expect(updated.acceptedAsLoanId).toBeUndefined();
  });
});
