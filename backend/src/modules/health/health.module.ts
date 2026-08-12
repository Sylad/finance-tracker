import { Module } from '@nestjs/common';
import { HealthStatusController } from './health-status.controller';
import { HealthCheckController } from './health.controller';
import { HealthThresholdsService } from './health-thresholds.service';
import { DemoCoreModule } from '../demo/demo-core.module';

@Module({
  imports: [DemoCoreModule],
  controllers: [HealthStatusController, HealthCheckController],
  providers: [HealthThresholdsService],
  exports: [HealthThresholdsService],
})
export class HealthCheckModule {}
