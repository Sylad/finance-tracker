import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { LoansService } from './loans.service';
import { validateLoanInput } from './dto/loan.dto';

@Controller('loans')
export class LoansController {
  constructor(private readonly svc: LoansService) {}

  @Get()
  list() { return this.svc.getAll(); }

  @Get(':id')
  one(@Param('id') id: string) { return this.svc.getOne(id); }

  @Post()
  create(@Body() body: unknown) { return this.svc.create(validateLoanInput(body)); }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.svc.update(id, validateLoanInput(body));
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string): Promise<void> { await this.svc.delete(id); }

  @Post(':id/reset-revolving')
  reset(@Param('id') id: string, @Body() body: { usedAmount: number }) {
    return this.svc.resetRevolving(id, Number(body.usedAmount));
  }

  @Post(':id/split-by-amount')
  split(@Param('id') id: string) {
    return this.svc.splitByAmount(id);
  }
}
