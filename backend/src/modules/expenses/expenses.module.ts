import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ExpensesService } from './expenses.service';
import { ExpensesController } from './expenses.controller';
import { StorageModule } from '../storage/storage.module';
import { LoansModule } from '../loans/loans.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { SavingsModule } from '../savings/savings.module';
import { CreditDetectionModule } from '../credit-detection/credit-detection.module';

@Module({
  imports: [ConfigModule, StorageModule, LoansModule, SubscriptionsModule, SavingsModule, CreditDetectionModule],
  controllers: [ExpensesController],
  providers: [ExpensesService],
})
export class ExpensesModule {}
