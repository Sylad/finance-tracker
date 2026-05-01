import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { StorageModule } from './modules/storage/storage.module';
import { AnalysisModule } from './modules/analysis/analysis.module';
import { StatementsModule } from './modules/statements/statements.module';
import { HealthModule } from './modules/health/health.module';
import { BudgetModule } from './modules/budget/budget.module';
import { ClaudeUsageModule } from './modules/claude-usage/claude-usage.module';
import { SnapshotsModule } from './modules/snapshots/snapshots.module';
import { EventsModule } from './modules/events/events.module';
import { DeclarationsModule } from './modules/declarations/declarations.module';

@Module({
  imports: [
    ConfigModule.forRoot({ load: [configuration], isGlobal: true }),
    EventsModule,
    ClaudeUsageModule,
    SnapshotsModule,
    StorageModule,
    AnalysisModule,
    StatementsModule,
    HealthModule,
    BudgetModule,
    DeclarationsModule,
  ],
})
export class AppModule {}
