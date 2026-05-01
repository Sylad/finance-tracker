import { Controller, Get, Put, Body } from '@nestjs/common';
import { ClaudeUsageService } from './claude-usage.service';

@Controller('claude')
export class ClaudeUsageController {
  constructor(private readonly service: ClaudeUsageService) {}

  @Get('usage')
  getUsage() {
    return this.service.getUsage();
  }

  @Put('balance')
  setBalance(@Body() body: { balanceUsd: number }) {
    this.service.setBalance(body.balanceUsd);
    return this.service.getUsage();
  }
}
