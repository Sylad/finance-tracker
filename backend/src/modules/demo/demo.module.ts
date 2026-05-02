import { Module } from '@nestjs/common';
import { DemoController } from './demo.controller';
import { DemoSeedService } from './demo-seed.service';
import { DemoModeMiddleware } from './demo-mode.middleware';

@Module({
  controllers: [DemoController],
  providers: [DemoSeedService, DemoModeMiddleware],
  exports: [DemoModeMiddleware],
})
export class DemoModule {}
