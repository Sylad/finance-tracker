import { ConflictException, Controller, Post } from '@nestjs/common';
import { CreditDetectionService } from './credit-detection.service';

@Controller('credit-detection')
export class CreditDetectionController {
  constructor(private readonly creditDetection: CreditDetectionService) {}

  @Post('scan')
  async scan() {
    const result = await this.creditDetection.scanAll();
    if (result.skipped) {
      throw new ConflictException(
        'Un scan de détection est déjà en cours — réessayez dans quelques instants.',
      );
    }
    return result;
  }
}
