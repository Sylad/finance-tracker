import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CandidateClusteringService } from './candidate-clustering.service';
import { CreditClassifierService } from './credit-classifier.service';

@Module({
  imports: [ConfigModule],
  providers: [CandidateClusteringService, CreditClassifierService],
  exports: [CandidateClusteringService, CreditClassifierService],
})
export class CreditDetectionModule {}
