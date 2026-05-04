import { Controller, Get, Put, Body } from '@nestjs/common';
import { z } from 'zod';
import { ClaudeUsageService } from './claude-usage.service';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';

const BalanceSchema = z.object({ balanceUsd: z.number().nonnegative() });

@Controller('claude')
export class ClaudeUsageController {
  constructor(private readonly service: ClaudeUsageService) {}

  @Get('usage')
  getUsage() {
    return this.service.getUsage();
  }

  @Put('balance')
  setBalance(@Body(new ZodValidationPipe(BalanceSchema)) body: { balanceUsd: number }) {
    this.service.setBalance(body.balanceUsd);
    return this.service.getUsage();
  }
}
