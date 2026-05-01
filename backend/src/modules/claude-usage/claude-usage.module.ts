import { Global, Module } from '@nestjs/common';
import { ClaudeUsageService } from './claude-usage.service';
import { ClaudeUsageController } from './claude-usage.controller';

@Global()
@Module({
  controllers: [ClaudeUsageController],
  providers: [ClaudeUsageService],
  exports: [ClaudeUsageService],
})
export class ClaudeUsageModule {}
