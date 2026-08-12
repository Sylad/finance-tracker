import { Module } from '@nestjs/common';
import { HealthStatusController } from './health-status.controller';
import { HealthCheckController } from './health.controller';
import { HealthAdviceService } from './health-advice.service';
import { HealthThresholdsService } from './health-thresholds.service';
import { HealthService } from './health.service';
import { DemoCoreModule } from '../demo/demo-core.module';
import { LoansModule } from '../loans/loans.module';
import { StorageModule } from '../storage/storage.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [DemoCoreModule, LoansModule, StorageModule, SubscriptionsModule],
  controllers: [HealthStatusController, HealthCheckController],
  providers: [HealthThresholdsService, HealthService, HealthAdviceService],
  exports: [HealthThresholdsService, HealthService, HealthAdviceService],
})
export class HealthCheckModule {}
