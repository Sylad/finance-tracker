import { Module } from '@nestjs/common';
import { AutoSyncService } from './auto-sync.service';
import { SavingsModule } from '../savings/savings.module';
import { LoansModule } from '../loans/loans.module';
import { LoanSuggestionsModule } from '../loan-suggestions/loan-suggestions.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [SavingsModule, LoansModule, LoanSuggestionsModule, EventsModule],
  providers: [AutoSyncService],
  exports: [AutoSyncService],
})
export class AutoSyncModule {}
