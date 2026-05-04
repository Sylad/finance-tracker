import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { LoanSuggestionsService } from './loan-suggestions.service';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';

const AcceptSchema = z.object({ loanId: z.string().min(1) });

@Controller('loan-suggestions')
export class LoanSuggestionsController {
  constructor(private readonly svc: LoanSuggestionsService) {}

  @Get()
  list() { return this.svc.getPending(); }

  @Post(':id/accept')
  accept(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AcceptSchema)) body: { loanId: string },
  ) {
    return this.svc.accept(id, body.loanId);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string) { return this.svc.reject(id); }

  @Post(':id/snooze')
  snooze(@Param('id') id: string) { return this.svc.snooze(id); }

  @Post(':id/unsnooze')
  unsnooze(@Param('id') id: string) { return this.svc.unsnooze(id); }
}
