import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly svc: DashboardService) {}

  @Get('net-worth')
  netWorth() { return this.svc.getNetWorth(); }

  @Get('alerts')
  alerts() { return this.svc.getAlerts(); }

  @Get('yearly-overview')
  yearly(@Query('months') months?: string) {
    return this.svc.getYearlyOverview(months ? parseInt(months, 10) : 12);
  }
}
