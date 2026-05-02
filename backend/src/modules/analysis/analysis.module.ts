import { Module } from '@nestjs/common';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';
import { AnthropicService } from './anthropic.service';
import { AutoSyncModule } from '../auto-sync/auto-sync.module';

@Module({
  imports: [AutoSyncModule],
  controllers: [AnalysisController],
  providers: [AnalysisService, AnthropicService],
  exports: [AnalysisService],
})
export class AnalysisModule {}
