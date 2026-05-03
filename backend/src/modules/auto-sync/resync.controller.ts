import { Body, Controller, Param, Post } from '@nestjs/common';
import { ResyncService } from './resync.service';
import { AutoSyncService } from './auto-sync.service';

@Controller('auto-sync')
export class ResyncController {
  constructor(
    private readonly svc: ResyncService,
    private readonly autoSync: AutoSyncService,
  ) {}

  @Post('savings/:id')
  resyncSavings(@Param('id') id: string) {
    return this.svc.resyncSavings(id);
  }

  @Post('loans/:id')
  resyncLoan(@Param('id') id: string, @Body() body: { baselineUsedAmount?: number }) {
    return this.svc.resyncLoan(id, body?.baselineUsedAmount);
  }

  @Post('recompute-loan-statuses')
  recomputeLoanStatuses() {
    return this.autoSync.recomputeLoanStatuses();
  }
}
