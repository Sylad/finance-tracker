import { Controller, Post } from '@nestjs/common';
import { CreditDetectionService } from './credit-detection.service';

@Controller('credit-detection')
export class CreditDetectionController {
  constructor(private readonly creditDetection: CreditDetectionService) {}

  @Post('scan')
  async scan() {
    return this.creditDetection.scanAll();
  }
}
