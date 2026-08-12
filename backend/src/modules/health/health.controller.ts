import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { HealthThresholdsService } from './health-thresholds.service';
import { HealthService } from './health.service';
import { HealthThresholds } from '../../models/health.model';

@Controller('health-check')
export class HealthCheckController {
  constructor(
    private readonly thresholds: HealthThresholdsService,
    private readonly health: HealthService,
  ) {}

  @Get('thresholds')
  getThresholds() { return this.thresholds.get(); }

  @Put('thresholds')
  putThresholds(@Body() body: Partial<HealthThresholds>) { return this.thresholds.update(body); }

  @Post('thresholds/reset')
  resetThresholds() { return this.thresholds.reset(); }

  @Get('diagnostic')
  getDiagnostic() { return this.health.getDiagnostic(); }
}
