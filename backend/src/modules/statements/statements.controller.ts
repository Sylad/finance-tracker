import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { StorageService } from '../storage/storage.service';
import { SnapshotService } from '../snapshots/snapshot.service';
import { AnalysisService } from '../analysis/analysis.service';
import { AutoSyncService } from '../auto-sync/auto-sync.service';
import { ImportLogsService } from '../import-logs/import-logs.service';
import { CategoryRulesService } from '../category-rules/category-rules.service';
import { TransactionCategory } from '../../models/transaction.model';

@Controller('statements')
export class StatementsController {
  constructor(
    private readonly storage: StorageService,
    private readonly snapshots: SnapshotService,
    private readonly analysis: AnalysisService,
    private readonly autoSync: AutoSyncService,
    private readonly importLogs: ImportLogsService,
    private readonly categoryRules: CategoryRulesService,
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

  @Patch(':id/transactions/:txId/category')
  async patchTransactionCategory(
    @Param('id') id: string,
    @Param('txId') txId: string,
    @Body() body: { category: string; subcategory?: string; createRule?: boolean; rulePattern?: string; replayAll?: boolean },
  ) {
    if (!body?.category) throw new BadRequestException('category requis');
    const stmt = await this.storage.getStatement(id);
    if (!stmt) throw new NotFoundException(`Relevé ${id} introuvable`);
    const tx = stmt.transactions.find((t) => t.id === txId);
    if (!tx) throw new NotFoundException(`Transaction ${txId} introuvable`);

    tx.category = body.category as TransactionCategory;
    tx.subcategory = body.subcategory ?? tx.subcategory;
    await this.storage.saveStatement(stmt);

    let createdRule = null;
    if (body.createRule) {
      const pattern = (body.rulePattern && body.rulePattern.trim())
        || this.escapeRegex(tx.normalizedDescription || tx.description);
      createdRule = await this.categoryRules.create({
        pattern,
        flags: 'i',
        category: body.category,
        subcategory: body.subcategory,
        priority: 100,
      });
    }

    let replayed = 0;
    if (body.createRule && body.replayAll) {
      const all = await this.storage.getAllStatements();
      for (const s of all) {
        const before = JSON.stringify(s.transactions.map((t) => [t.id, t.category, t.subcategory]));
        s.transactions = await this.categoryRules.apply(s.transactions);
        const after = JSON.stringify(s.transactions.map((t) => [t.id, t.category, t.subcategory]));
        if (before !== after) {
          await this.storage.saveStatement(s);
          replayed++;
        }
      }
    }

    return { transaction: tx, createdRule, replayed };
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
