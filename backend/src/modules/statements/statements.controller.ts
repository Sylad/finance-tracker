import { Controller, Get, Param, Delete, NotFoundException } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';
import { SnapshotService } from '../snapshots/snapshot.service';

@Controller('statements')
export class StatementsController {
  constructor(
    private readonly storage: StorageService,
    private readonly snapshots: SnapshotService,
  ) {}

  @Get()
  async findAll() {
    return this.storage.getAllSummaries();
  }

  @Get('score-history')
  async getScoreHistory() {
    return this.storage.getScoreHistory();
  }

  @Get('recurring-credits')
  async getRecurringCredits() {
    return this.storage.getAggregatedRecurringCredits();
  }

  @Get('yearly')
  async getYearlySummaries() {
    return this.storage.getAllYearlySummaries();
  }

  @Get('yearly/:year')
  async getYearlySummary(@Param('year') year: string) {
    const summary = await this.storage.getYearlySummary(parseInt(year, 10));
    if (!summary) throw new NotFoundException(`Bilan ${year} introuvable`);
    return summary;
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const statement = await this.storage.getStatement(id);
    if (!statement) throw new NotFoundException(`Relevé ${id} introuvable`);
    return statement;
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.snapshots.takeSnapshot(`before-delete-${id}`);
    const deleted = await this.storage.deleteStatement(id);
    if (!deleted) throw new NotFoundException(`Relevé ${id} introuvable`);
    return { message: `Relevé ${id} supprimé` };
  }
}
