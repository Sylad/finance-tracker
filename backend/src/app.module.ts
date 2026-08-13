import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { DemoCoreModule } from './modules/demo/demo-core.module';
import { DemoModule } from './modules/demo/demo.module';
import { DemoModeMiddleware } from './modules/demo/demo-mode.middleware';
import { StorageModule } from './modules/storage/storage.module';
import { AnalysisModule } from './modules/analysis/analysis.module';
import { StatementsModule } from './modules/statements/statements.module';
import { HealthCheckModule } from './modules/health/health.module';
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
import { ImportLogsModule } from './modules/import-logs/import-logs.module';
import { CategoryRulesModule } from './modules/category-rules/category-rules.module';
import { AutoCategorizeModule } from './modules/auto-categorize/auto-categorize.module';
import { CategoryRuleSuggestionsModule } from './modules/category-rule-suggestions/category-rule-suggestions.module';
import { AnomaliesModule } from './modules/anomalies/anomalies.module';
import { GoalsModule } from './modules/goals/goals.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { CreditDetectionModule } from './modules/credit-detection/credit-detection.module';
import { ExpensesModule } from './modules/expenses/expenses.module';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      // __dirname à l'exécution = backend/dist → remonte vers frontend/dist
      rootPath: join(__dirname, '..', '..', 'frontend', 'dist'),
      // Ne pas intercepter les routes API (Express 5 / path-to-regexp v8)
      exclude: ['/api/{*path}'],
    }),
    ConfigModule.forRoot({ load: [configuration], isGlobal: true }),
    DemoCoreModule,
    DemoModule,
    EventsModule,
    ClaudeUsageModule,
    SnapshotsModule,
    StorageModule,
    AnalysisModule,
    StatementsModule,
    HealthCheckModule,
    BudgetModule,
    DeclarationsModule,
    SavingsModule,
    LoansModule,
    AutoSyncModule,
    LoanSuggestionsModule,
    DashboardModule,
    ImportLogsModule,
    CategoryRulesModule,
    AutoCategorizeModule,
    CategoryRuleSuggestionsModule,
    AnomaliesModule,
    GoalsModule,
    SubscriptionsModule,
    CreditDetectionModule,
    ExpensesModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply DemoModeMiddleware on EVERYTHING (including /api/demo/*) so the
    // forced-by-host detection populates the ALS context for the status endpoint.
    consumer
      .apply(DemoModeMiddleware)
      .exclude({ path: 'health', method: RequestMethod.ALL })
      .forRoutes('*');
  }
}
