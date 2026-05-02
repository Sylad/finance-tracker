import { Module } from '@nestjs/common';
import { LoanSuggestionsController } from './loan-suggestions.controller';
import { LoanSuggestionsService } from './loan-suggestions.service';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [EventsModule],
  controllers: [LoanSuggestionsController],
  providers: [LoanSuggestionsService],
  exports: [LoanSuggestionsService],
})
export class LoanSuggestionsModule {}
