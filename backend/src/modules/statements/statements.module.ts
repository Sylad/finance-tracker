import { Module } from '@nestjs/common';
import { StatementsController } from './statements.controller';
import { AnalysisModule } from '../analysis/analysis.module';
import { StorageModule } from '../storage/storage.module';
import { SnapshotsModule } from '../snapshots/snapshots.module';
import { AutoSyncModule } from '../auto-sync/auto-sync.module';
import { ImportLogsModule } from '../import-logs/import-logs.module';
import { CategoryRulesModule } from '../category-rules/category-rules.module';
import { ScoreCalculatorModule } from '../score/score-calculator.module';

@Module({
  imports: [AnalysisModule, StorageModule, SnapshotsModule, AutoSyncModule, ImportLogsModule, CategoryRulesModule, ScoreCalculatorModule],
  controllers: [StatementsController],
})
export class StatementsModule {}
