import { Module } from '@nestjs/common';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';
import { AnthropicService } from './anthropic.service';
import { AutoSyncModule } from '../auto-sync/auto-sync.module';
import { ImportLogsModule } from '../import-logs/import-logs.module';
import { CategoryRulesModule } from '../category-rules/category-rules.module';

@Module({
  imports: [AutoSyncModule, ImportLogsModule, CategoryRulesModule],
  controllers: [AnalysisController],
  providers: [AnalysisService, AnthropicService],
  exports: [AnalysisService],
})
export class AnalysisModule {}
