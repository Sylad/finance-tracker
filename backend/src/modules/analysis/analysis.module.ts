import { Module } from '@nestjs/common';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';
import { AnthropicService } from './anthropic.service';

@Module({
  controllers: [AnalysisController],
  providers: [AnalysisService, AnthropicService],
  exports: [AnalysisService],
})
export class AnalysisModule {}
