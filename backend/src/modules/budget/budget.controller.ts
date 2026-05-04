import { Controller, Get, Put, Body } from '@nestjs/common';
import { z } from 'zod';
import { BudgetService } from './budget.service';
import { SnapshotService } from '../snapshots/snapshot.service';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';

const BudgetsSchema = z.record(z.string(), z.number().nonnegative());

@Controller('budgets')
export class BudgetController {
  constructor(
    private readonly budgetService: BudgetService,
    private readonly snapshots: SnapshotService,
  ) {}

  @Get()
  getBudgets() {
    return this.budgetService.getBudgets();
  }

  @Put()
  async saveBudgets(@Body(new ZodValidationPipe(BudgetsSchema)) body: Record<string, number>) {
    await this.snapshots.takeSnapshot('before-budget-overwrite');
    return this.budgetService.saveBudgets(body);
  }
}
