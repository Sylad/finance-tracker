import { Module } from '@nestjs/common';
import { LoansController } from './loans.controller';
import { LoansService } from './loans.service';
import { ImportOrchestratorService } from './import-orchestrator.service';
import { EventsModule } from '../events/events.module';
import { CreditStatementService } from '../analysis/credit-statement.service';
import { AmortizationService } from '../analysis/amortization.service';

@Module({
  imports: [EventsModule],
  controllers: [LoansController],
  providers: [LoansService, ImportOrchestratorService, CreditStatementService, AmortizationService],
  exports: [LoansService, ImportOrchestratorService],
})
export class LoansModule {}
