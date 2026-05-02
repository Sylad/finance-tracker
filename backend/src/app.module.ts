import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { DemoCoreModule } from './modules/demo/demo-core.module';
import { StorageModule } from './modules/storage/storage.module';
import { AnalysisModule } from './modules/analysis/analysis.module';
import { StatementsModule } from './modules/statements/statements.module';
import { HealthModule } from './modules/health/health.module';
import { BudgetModule } from './modules/budget/budget.module';
import { ClaudeUsageModule } from './modules/claude-usage/claude-usage.module';
import { SnapshotsModule } from './modules/snapshots/snapshots.module';
import { EventsModule } from './modules/events/events.module';
import { DeclarationsModule } from './modules/declarations/declarations.module';
import { SavingsModule } from './modules/savings/savings.module';
import { LoansModule } from './modules/loans/loans.module';
import { AutoSyncModule } from './modules/auto-sync/auto-sync.module';
import { LoanSuggestionsModule } from './modules/loan-suggestions/loan-suggestions.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({ load: [configuration], isGlobal: true }),
    DemoCoreModule,
    EventsModule,
    ClaudeUsageModule,
    SnapshotsModule,
    StorageModule,
    AnalysisModule,
    StatementsModule,
    HealthModule,
    BudgetModule,
    DeclarationsModule,
    SavingsModule,
    LoansModule,
    AutoSyncModule,
    LoanSuggestionsModule,
    DashboardModule,
  ],
})
export class AppModule {}
