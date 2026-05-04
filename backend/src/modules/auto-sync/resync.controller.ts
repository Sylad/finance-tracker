import { Body, Controller, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { ResyncService } from './resync.service';
import { AutoSyncService } from './auto-sync.service';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';

const ResyncLoanSchema = z.object({
  baselineUsedAmount: z.number().nonnegative().optional(),
});

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
  resyncLoan(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ResyncLoanSchema)) body: z.infer<typeof ResyncLoanSchema>,
  ) {
    return this.svc.resyncLoan(id, body.baselineUsedAmount);
  }

  @Post('recompute-loan-statuses')
  recomputeLoanStatuses() {
    return this.autoSync.recomputeLoanStatuses();
  }
}
