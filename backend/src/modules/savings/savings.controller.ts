import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { SavingsService } from './savings.service';
import { validateSavingsAccountInput } from './dto/savings-account.dto';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';

const MovementSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date YYYY-MM-DD attendue'),
  amount: z.number(),
  note: z.string().optional(),
});

@Controller('savings-accounts')
export class SavingsController {
  constructor(private readonly svc: SavingsService) {}

  @Get()
  list() { return this.svc.getAll(); }

  @Get(':id')
  one(@Param('id') id: string) { return this.svc.getOne(id); }

  @Post()
  create(@Body() body: unknown) { return this.svc.create(validateSavingsAccountInput(body)); }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.svc.update(id, validateSavingsAccountInput(body));
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string): Promise<void> { await this.svc.delete(id); }

  @Post(':id/movements')
  addMovement(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(MovementSchema)) body: z.infer<typeof MovementSchema>,
  ) {
    return this.svc.addMovement(id, {
      date: body.date,
      amount: body.amount,
      source: 'manual',
      note: body.note,
    });
  }

  @Get(':id/balance-history')
  history(@Param('id') id: string, @Query('months') months?: string) {
    return this.svc.getBalanceHistory(id, months ? parseInt(months, 10) : 12);
  }
}
