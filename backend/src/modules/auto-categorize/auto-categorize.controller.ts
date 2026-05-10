import { BadRequestException, Body, Controller, Param, Post } from '@nestjs/common';
import { AutoCategorizeService } from './auto-categorize.service';

interface ApplyDecisionDto {
  transactionId: string;
  category: string;
  rulePattern?: string;
  replayAll?: boolean;
}

interface ApplyBodyDto {
  decisions: ApplyDecisionDto[];
}

@Controller('auto-categorize')
export class AutoCategorizeController {
  constructor(private readonly service: AutoCategorizeService) {}

  /** Preview suggestions for the `other` transactions of the statement. */
  @Post(':statementId/preview')
  async preview(@Param('statementId') statementId: string) {
    return this.service.preview(statementId);
  }

  /** Apply decisions in bulk + optionally create category rules. */
  @Post(':statementId/apply')
  async apply(@Param('statementId') statementId: string, @Body() body: ApplyBodyDto) {
    if (!body || !Array.isArray(body.decisions)) {
      throw new BadRequestException('Le corps doit contenir un tableau `decisions`');
    }
    for (const d of body.decisions) {
      if (typeof d?.transactionId !== 'string' || !d.transactionId) {
        throw new BadRequestException('Chaque décision doit avoir un transactionId');
      }
      if (typeof d?.category !== 'string' || !d.category) {
        throw new BadRequestException('Chaque décision doit avoir une category');
      }
    }
    return this.service.apply(statementId, body.decisions);
  }
}
