import { Module } from '@nestjs/common';
import { LoanSuggestionsController } from './loan-suggestions.controller';
import { LoanSuggestionsService } from './loan-suggestions.service';
import { EventsModule } from '../events/events.module';
import { LoansModule } from '../loans/loans.module';

@Module({
  imports: [EventsModule, LoansModule],
  controllers: [LoanSuggestionsController],
  providers: [LoanSuggestionsService],
  exports: [LoanSuggestionsService],
})
export class LoanSuggestionsModule {}
