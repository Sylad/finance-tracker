import { Controller, Get, Put, Body } from '@nestjs/common';
import { BudgetService } from './budget.service';
import { SnapshotService } from '../snapshots/snapshot.service';

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
  async saveBudgets(@Body() body: Record<string, number>) {
    await this.snapshots.takeSnapshot('before-budget-overwrite');
    return this.budgetService.saveBudgets(body);
  }
}
