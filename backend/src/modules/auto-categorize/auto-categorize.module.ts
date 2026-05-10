import { Module } from '@nestjs/common';
import { AutoCategorizeController } from './auto-categorize.controller';
import { AutoCategorizeService } from './auto-categorize.service';
import { CategoryRulesModule } from '../category-rules/category-rules.module';

@Module({
  // StorageModule, ClaudeUsageModule, DemoCoreModule are @Global so they need no import here.
  imports: [CategoryRulesModule],
  controllers: [AutoCategorizeController],
  providers: [AutoCategorizeService],
  exports: [AutoCategorizeService],
})
export class AutoCategorizeModule {}
