import { Controller, Delete, Get, HttpCode, Post, Query } from '@nestjs/common';
import { DemoSeedService } from './demo-seed.service';

@Controller('demo')
export class DemoController {
  constructor(private readonly seed: DemoSeedService) {}

  @Get('status')
  status() { return this.seed.status(); }

  @Post('seed')
  doSeed(@Query('force') force?: string) { return this.seed.seed(force === 'true'); }

  @Delete('data')
  @HttpCode(204)
  async reset(): Promise<void> { await this.seed.reset(); }
}
