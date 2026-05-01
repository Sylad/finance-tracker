import { Module } from '@nestjs/common';
import { DeclarationsController } from './declarations.controller';
import { DeclarationsService } from './declarations.service';
import { ForecastService } from './forecast.service';

@Module({
  controllers: [DeclarationsController],
  providers: [DeclarationsService, ForecastService],
})
export class DeclarationsModule {}
