import { Body, Controller, Delete, Get, NotFoundException, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { StorageService } from '../storage/storage.service';
import { SnapshotService } from '../snapshots/snapshot.service';
import { AnalysisService } from '../analysis/analysis.service';

@Controller('statements')
export class StatementsController {
  constructor(
    private readonly storage: StorageService,
    private readonly snapshots: SnapshotService,
    private readonly analysis: AnalysisService,
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

  @Post(':id/reanalyze')
  @UseInterceptors(FileInterceptor('file'))
  async reanalyze(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new NotFoundException('PDF requis pour re-analyser');
    return this.analysis.reanalyzeStatement(id, file.buffer);
  }
}
