import { Module } from '@nestjs/common';
import { LoansController } from './loans.controller';
import { LoansService } from './loans.service';
import { EventsModule } from '../events/events.module';
import { CreditStatementService } from '../analysis/credit-statement.service';

@Module({
  imports: [EventsModule],
  controllers: [LoansController],
  providers: [LoansService, CreditStatementService],
  exports: [LoansService],
})
export class LoansModule {}
