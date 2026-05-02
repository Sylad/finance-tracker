import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { LoanSuggestionsService } from './loan-suggestions.service';

@Controller('loan-suggestions')
export class LoanSuggestionsController {
  constructor(private readonly svc: LoanSuggestionsService) {}

  @Get()
  list() { return this.svc.getPending(); }

  @Post(':id/accept')
  accept(@Param('id') id: string, @Body() body: { loanId: string }) {
    return this.svc.accept(id, body.loanId);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string) { return this.svc.reject(id); }

  @Post(':id/snooze')
  snooze(@Param('id') id: string) { return this.svc.snooze(id); }
}
