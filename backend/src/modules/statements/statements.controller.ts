import { BadRequestException, Controller, Delete, Get, NotFoundException, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { StorageService } from '../storage/storage.service';
import { SnapshotService } from '../snapshots/snapshot.service';
import { AnalysisService } from '../analysis/analysis.service';
import { AutoSyncService } from '../auto-sync/auto-sync.service';
import { ImportLogsService } from '../import-logs/import-logs.service';

@Controller('statements')
export class StatementsController {
  constructor(
    private readonly storage: StorageService,
    private readonly snapshots: SnapshotService,
    private readonly analysis: AnalysisService,
    private readonly autoSync: AutoSyncService,
    private readonly importLogs: ImportLogsService,
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
    await this.autoSync.removeForStatement(id);
    const deleted = await this.storage.deleteStatement(id);
    if (!deleted) throw new NotFoundException(`Relevé ${id} introuvable`);
    return { message: `Relevé ${id} supprimé` };
  }

  @Post(':id/reanalyze')
  @UseInterceptors(FileInterceptor('file', {
    fileFilter: (req, file, cb) => {
      if (file.mimetype !== 'application/pdf') {
        return cb(new BadRequestException('Seuls les fichiers PDF sont acceptés'), false);
      }
      cb(null, true);
    },
    limits: { fileSize: 20 * 1024 * 1024 },
  }))
  async reanalyze(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new NotFoundException('PDF requis pour re-analyser');
    const startedAt = Date.now();
    const uploadedAt = new Date().toISOString();
    const pendingLog = await this.importLogs.log({
      filename: file.originalname,
      uploadedAt,
      durationMs: 0,
      status: 'in-progress',
    });
    try {
      const result = await this.analysis.reanalyzeStatement(id, file.buffer);
      await this.importLogs.update(pendingLog.id, {
        durationMs: Date.now() - startedAt,
        status: 'success',
        statementId: result.statement.id,
        statementMonth: result.statement.month,
        statementYear: result.statement.year,
        replaced: result.replaced,
      });
      return result;
    } catch (e) {
      await this.importLogs.update(pendingLog.id, {
        durationMs: Date.now() - startedAt,
        status: 'error',
        error: (e as Error).message ?? 'Unknown error',
      });
      throw e;
    }
  }
}
