import { Module } from '@nestjs/common';
import { HealthCheckController } from './health.controller';
import { HealthThresholdsService } from './health-thresholds.service';
import { DemoCoreModule } from '../demo/demo-core.module';

@Module({
  imports: [DemoCoreModule],
  controllers: [HealthCheckController],
  providers: [HealthThresholdsService],
  exports: [HealthThresholdsService],
})
export class HealthCheckModule {}
