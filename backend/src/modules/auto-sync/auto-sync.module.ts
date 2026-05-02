import { Module } from '@nestjs/common';
import { AutoSyncService } from './auto-sync.service';
import { SavingsModule } from '../savings/savings.module';
import { LoansModule } from '../loans/loans.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [SavingsModule, LoansModule, EventsModule],
  providers: [AutoSyncService],
  exports: [AutoSyncService],
})
export class AutoSyncModule {}
