import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CandidateClusteringService } from './candidate-clustering.service';
import { CreditClassifierService } from './credit-classifier.service';
import { DetectionValidatorService } from './detection-validator.service';
import { LoansModule } from '../loans/loans.module';
import { LoanSuggestionsModule } from '../loan-suggestions/loan-suggestions.module';

@Module({
  imports: [ConfigModule, LoansModule, LoanSuggestionsModule],
  providers: [
    CandidateClusteringService,
    CreditClassifierService,
    DetectionValidatorService,
  ],
  exports: [
    CandidateClusteringService,
    CreditClassifierService,
    DetectionValidatorService,
  ],
})
export class CreditDetectionModule {}
