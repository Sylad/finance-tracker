import { Module } from '@nestjs/common';
import { AutoSyncService } from './auto-sync.service';
import { ResyncService } from './resync.service';
import { ResyncController } from './resync.controller';
import { SavingsModule } from '../savings/savings.module';
import { LoansModule } from '../loans/loans.module';
import { LoanSuggestionsModule } from '../loan-suggestions/loan-suggestions.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [SavingsModule, LoansModule, LoanSuggestionsModule, EventsModule],
  controllers: [ResyncController],
  providers: [AutoSyncService, ResyncService],
  exports: [AutoSyncService],
})
export class AutoSyncModule {}
