import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CategoryRuleSuggestionsController } from './category-rule-suggestions.controller';
import { CategoryRuleSuggestionsService } from './category-rule-suggestions.service';
import { EventsModule } from '../events/events.module';
import { StorageModule } from '../storage/storage.module';
import { CategoryRulesModule } from '../category-rules/category-rules.module';
import { DemoModule } from '../demo/demo.module';

@Module({
  imports: [
    ConfigModule,
    EventsModule,
    StorageModule,
    CategoryRulesModule,
    DemoModule,
  ],
  controllers: [CategoryRuleSuggestionsController],
  providers: [CategoryRuleSuggestionsService],
  exports: [CategoryRuleSuggestionsService],
})
export class CategoryRuleSuggestionsModule {}
