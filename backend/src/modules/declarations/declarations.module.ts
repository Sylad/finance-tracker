import { Module } from '@nestjs/common';
import { DeclarationsController } from './declarations.controller';
import { DeclarationsService } from './declarations.service';
import { ForecastService } from './forecast.service';
import { LoansModule } from '../loans/loans.module';

@Module({
  imports: [LoansModule],
  controllers: [DeclarationsController],
  providers: [DeclarationsService, ForecastService],
})
export class DeclarationsModule {}
