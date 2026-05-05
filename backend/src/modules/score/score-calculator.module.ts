import { Module } from '@nestjs/common';
import { ScoreCalculatorService } from './score-calculator.service';

@Module({
  providers: [ScoreCalculatorService],
  exports: [ScoreCalculatorService],
})
export class ScoreCalculatorModule {}
