import {
  BadGatewayException,
  Body,
  Controller,
  Get,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { HealthAdviceService } from './health-advice.service';
import { HealthThresholdsService } from './health-thresholds.service';
import { HealthService } from './health.service';
import { HealthThresholds } from '../../models/health.model';

@Controller('health-check')
export class HealthCheckController {
  constructor(
    private readonly thresholds: HealthThresholdsService,
    private readonly health: HealthService,
    private readonly advice: HealthAdviceService,
  ) {}

  @Get('thresholds')
  getThresholds() {
    return this.thresholds.get();
  }

  @Put('thresholds')
  putThresholds(@Body() body: Partial<HealthThresholds>) {
    return this.thresholds.update(body);
  }

  @Post('thresholds/reset')
  resetThresholds() {
    return this.thresholds.reset();
  }

  @Get('diagnostic')
  getDiagnostic() {
    return this.health.getDiagnostic();
  }

  @Post('advice')
  async generateAdvice() {
    try {
      return await this.advice.generate();
    } catch (err) {
      throw new BadGatewayException(
        `Ollama indisponible : ${(err as Error).message}`,
      );
    }
  }

  @Get('advice')
  async getAdvice(@Res({ passthrough: true }) res: Response) {
    const cached = await this.advice.getCached();
    if (!cached) {
      res.status(204);
      return;
    }
    return cached;
  }
}
