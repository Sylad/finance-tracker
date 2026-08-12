import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CandidateClusteringService } from './candidate-clustering.service';
import { CreditClassifierService } from './credit-classifier.service';
import { DetectionValidatorService } from './detection-validator.service';
import { CreditDetectionService } from './credit-detection.service';
import { CreditDetectionController } from './credit-detection.controller';
import { LoansModule } from '../loans/loans.module';
import { LoanSuggestionsModule } from '../loan-suggestions/loan-suggestions.module';
import { StorageModule } from '../storage/storage.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ImportLogsModule } from '../import-logs/import-logs.module';

@Module({
  imports: [
    ConfigModule,
    LoansModule,
    LoanSuggestionsModule,
    StorageModule,
    SubscriptionsModule,
    ImportLogsModule,
  ],
  controllers: [CreditDetectionController],
  providers: [
    CandidateClusteringService,
    CreditClassifierService,
    DetectionValidatorService,
    CreditDetectionService,
  ],
  exports: [
    CandidateClusteringService,
    CreditClassifierService,
    DetectionValidatorService,
    CreditDetectionService,
  ],
})
export class CreditDetectionModule {}
