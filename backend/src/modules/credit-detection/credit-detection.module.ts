import { Module } from '@nestjs/common';
import { CandidateClusteringService } from './candidate-clustering.service';

@Module({
  providers: [CandidateClusteringService],
  exports: [CandidateClusteringService],
})
export class CreditDetectionModule {}
