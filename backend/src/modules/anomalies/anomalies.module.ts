import { Module } from '@nestjs/common';
import { AnomaliesController } from './anomalies.controller';
import { AnomalyDetectorService } from './anomaly-detector.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [AnomaliesController],
  providers: [AnomalyDetectorService],
  exports: [AnomalyDetectorService],
})
export class AnomaliesModule {}
