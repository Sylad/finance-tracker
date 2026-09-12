import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ResyncService } from './resync.service';
import { AutoSyncService } from './auto-sync.service';
import { StorageService } from '../storage/storage.service';
import { SavingsService } from '../savings/savings.service';
import { LoansService } from '../loans/loans.service';

describe('ResyncService.replayStatement', () => {
  let svc: ResyncService;
  let autoSync: { replaySavings: jest.Mock; replayLoans: jest.Mock; recomputeLoanStatuses: jest.Mock };
  let storage: { getStatement: jest.Mock; getAllStatements: jest.Mock };

  beforeEach(async () => {
    autoSync = { replaySavings: jest.fn(), replayLoans: jest.fn(), recomputeLoanStatuses: jest.fn().mockResolvedValue({ deactivated: 0 }) };
    storage = { getStatement: jest.fn(), getAllStatements: jest.fn().mockResolvedValue([]) };
    const mod = await Test.createTestingModule({
      providers: [
        ResyncService,
        { provide: AutoSyncService, useValue: autoSync },
        { provide: StorageService, useValue: storage },
        { provide: SavingsService, useValue: {} },
        { provide: LoansService, useValue: {} },
      ],
    }).compile();
    svc = mod.get(ResyncService);
  });

  it('rejoue épargne puis crédits sur le relevé demandé, puis ré-évalue les statuts', async () => {
    const stmt = { id: '2026-08', month: 8, year: 2026 };
    storage.getStatement.mockResolvedValue(stmt);
    const res = await svc.replayStatement('2026-08');
    expect(autoSync.replaySavings).toHaveBeenCalledWith(stmt);
    expect(autoSync.replayLoans).toHaveBeenCalledWith(stmt);
    expect(autoSync.recomputeLoanStatuses).toHaveBeenCalled();
    expect(res).toEqual({ statementId: '2026-08' });
  });

  it('404 si le relevé n\'existe pas', async () => {
    storage.getStatement.mockResolvedValue(null);
    await expect(svc.replayStatement('1999-01')).rejects.toBeInstanceOf(NotFoundException);
  });
});
