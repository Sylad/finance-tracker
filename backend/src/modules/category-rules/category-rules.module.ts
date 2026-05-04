import { Module } from '@nestjs/common';
import { CategoryRulesController } from './category-rules.controller';
import { CategoryRulesService } from './category-rules.service';
import { EventsModule } from '../events/events.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [EventsModule, StorageModule],
  controllers: [CategoryRulesController],
  providers: [CategoryRulesService],
  exports: [CategoryRulesService],
})
export class CategoryRulesModule {}
