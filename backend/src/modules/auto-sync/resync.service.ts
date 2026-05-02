import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AutoSyncService } from './auto-sync.service';
import { StorageService } from '../storage/storage.service';
import { SavingsService } from '../savings/savings.service';
import { LoansService } from '../loans/loans.service';

@Injectable()
export class ResyncService {
  private readonly logger = new Logger(ResyncService.name);

  constructor(
    private readonly autoSync: AutoSyncService,
    private readonly storage: StorageService,
    private readonly savings: SavingsService,
    private readonly loans: LoansService,
  ) {}

  async resyncSavings(id: string): Promise<{ rescanned: number }> {
    await this.savings.getOne(id);
    await this.savings.clearDetectedMovements(id);
    const statements = await this.storage.getAllStatements();
    for (const s of statements) {
      await this.autoSync.syncStatement(s);
    }
    this.logger.log(`Resynced savings ${id} over ${statements.length} statements`);
    return { rescanned: statements.length };
  }

  async resyncLoan(id: string, baselineUsedAmount?: number): Promise<{ rescanned: number }> {
    const loan = await this.loans.getOne(id);
    if (loan.type === 'revolving' && baselineUsedAmount === undefined) {
      throw new BadRequestException(
        `Pour un crédit revolving, fournis 'baselineUsedAmount' (le solde utilisé au point de départ avant les remboursements détectés).`,
      );
    }
    await this.loans.clearOccurrencesAndResetBalance(id, baselineUsedAmount);
    const statements = await this.storage.getAllStatements();
    for (const s of statements) {
      await this.autoSync.syncStatement(s);
    }
    this.logger.log(`Resynced loan ${id} over ${statements.length} statements`);
    return { rescanned: statements.length };
  }
}
