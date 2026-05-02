import { Body, Controller, Param, Post } from '@nestjs/common';
import { ResyncService } from './resync.service';

@Controller('auto-sync')
export class ResyncController {
  constructor(private readonly svc: ResyncService) {}

  @Post('savings/:id')
  resyncSavings(@Param('id') id: string) {
    return this.svc.resyncSavings(id);
  }

  @Post('loans/:id')
  resyncLoan(@Param('id') id: string, @Body() body: { baselineUsedAmount?: number }) {
    return this.svc.resyncLoan(id, body?.baselineUsedAmount);
  }
}
