import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { StorageService } from '../storage/storage.service';
import { escapeRegex } from '../../common/regex.util';
import { SnapshotService } from '../snapshots/snapshot.service';
import { AnalysisService } from '../analysis/analysis.service';
import { AutoSyncService } from '../auto-sync/auto-sync.service';
import { ImportLogsService } from '../import-logs/import-logs.service';
import { CategoryRulesService } from '../category-rules/category-rules.service';
import type { MerchantRuleSkipped } from '../category-rules/merchant-dictionary';
import { ScoreCalculatorService } from '../score/score-calculator.service';
import { CreditDetectionService } from '../credit-detection/credit-detection.service';
import { TransactionCategory } from '../../models/transaction.model';
import { pdfFileFilter } from '../../common/pdf-upload-filter';

@Controller('statements')
export class StatementsController {
  private readonly logger = new Logger(StatementsController.name);

  constructor(
    private readonly storage: StorageService,
    private readonly snapshots: SnapshotService,
    private readonly analysis: AnalysisService,
    private readonly autoSync: AutoSyncService,
    private readonly importLogs: ImportLogsService,
    private readonly categoryRules: CategoryRulesService,
    private readonly scoreCalc: ScoreCalculatorService,
    private readonly creditDetection: CreditDetectionService,
  ) {}

  /**
   * Rejoue la règle « revenu exceptionnel » sur un relevé déjà stocké (sans
   * relancer l'analyse Claude) et persiste. Réponse : les crédits flaggés.
   */
  @Post(':id/exceptional-income')
  async applyExceptionalIncome(@Param('id') id: string) {
    const stmt = await this.storage.getStatement(id);
    if (!stmt) throw new NotFoundException(`Relevé ${id} introuvable`);
    const flags = await this.analysis.applyExceptionalIncome(stmt);
    if (flags.length > 0) await this.storage.saveStatement(stmt);
    return { statementId: id, flags };
  }

  @Post('rescore-all')
  async rescoreAll() {
    const all = await this.storage.getAllStatements();
    let updated = 0;
    for (const stmt of all) {
      const before = JSON.stringify(stmt.healthScore);
      const fresh = this.scoreCalc.compute(
        stmt,
        stmt.healthScore.claudeComment,
      );
      stmt.healthScore = fresh;
      if (JSON.stringify(stmt.healthScore) !== before) {
        await this.storage.saveStatement(stmt);
        updated++;
      }
    }
    return { processed: all.length, updated };
  }

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

  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportCsv(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const all = await this.storage.getAllStatements();
    const sorted = all
      .filter((s) => (!from || s.id >= from) && (!to || s.id <= to))
      .sort((a, b) => a.id.localeCompare(b.id));

    const periodLabel =
      sorted.length === 0
        ? 'vide'
        : sorted.length === 1
          ? sorted[0].id
          : `${sorted[0].id}_to_${sorted[sorted.length - 1].id}`;
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="finance-tracker-${periodLabel}.csv"`,
    );

    const lines: string[] = [];
    lines.push(
      [
        'Mois',
        'Date',
        'Libellé',
        'Catégorie',
        'Sous-catégorie',
        'Récurrent',
        'Montant (€)',
      ]
        .map(csv)
        .join(','),
    );
    for (const s of sorted) {
      const monthLabel = `${s.year}-${String(s.month).padStart(2, '0')}`;
      const txs = [...s.transactions].sort((a, b) =>
        a.date.localeCompare(b.date),
      );
      for (const t of txs) {
        lines.push(
          [
            monthLabel,
            t.date,
            t.description,
            t.category,
            t.subcategory,
            t.isRecurring ? 'oui' : '',
            t.amount.toFixed(2).replace('.', ','),
          ]
            .map(csv)
            .join(','),
        );
      }
    }
    // BOM so Excel auto-detects UTF-8
    return '﻿' + lines.join('\n');
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
    @Body()
    body: {
      category: string;
      subcategory?: string;
      createRule?: boolean;
      rulePattern?: string;
      replayAll?: boolean;
      memorizeMerchant?: boolean;
    },
  ) {
    if (!body?.category) throw new BadRequestException('category requis');
    // Slug sain uniquement : une catégorie arbitraire persistée polluait les
    // agrégats (yearly topCategories, budgets) sans erreur nulle part.
    if (!/^[a-z0-9-]{1,30}$/.test(body.category)) {
      throw new BadRequestException(`Catégorie invalide : ${body.category}`);
    }
    const stmt = await this.storage.getStatement(id);
    if (!stmt) throw new NotFoundException(`Relevé ${id} introuvable`);
    const tx = stmt.transactions.find((t) => t.id === txId);
    if (!tx) throw new NotFoundException(`Transaction ${txId} introuvable`);

    tx.category = body.category as TransactionCategory;
    tx.subcategory = body.subcategory ?? tx.subcategory;
    await this.storage.saveStatement(stmt);

    let createdRule = null;
    let ruleSkipped: MerchantRuleSkipped | undefined;
    if (body.createRule) {
      const pattern =
        (body.rulePattern && body.rulePattern.trim()) ||
        escapeRegex(tx.normalizedDescription || tx.description);
      createdRule = await this.categoryRules.create({
        pattern,
        flags: 'i',
        category: body.category,
        subcategory: body.subcategory,
        priority: 100,
      });
    } else if (body.memorizeMerchant === true) {
      // « Mémoriser pour ce marchand » (L75) : seul le booléen true l'active ;
      // createRule, s'il est vrai, garde la priorité (chemin existant seul).
      const memo = await this.categoryRules.memorizeMerchant(tx, body.category, body.subcategory);
      createdRule = memo.rule;
      ruleSkipped = memo.skipped;
      if (ruleSkipped) {
        this.logger.warn(`Merchant rule not created for transaction ${txId}: ${ruleSkipped}`);
      }
    }

    // Le relevé courant est rejoué aussi : ses autres transactions peuvent
    // correspondre à la nouvelle règle.
    const replayed =
      createdRule && body.replayAll && (body.createRule || body.memorizeMerchant === true)
        ? (await this.categoryRules.replayAll()).updated
        : 0;

    return ruleSkipped
      ? { transaction: tx, createdRule, replayed, ruleSkipped }
      : { transaction: tx, createdRule, replayed };
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
  @UseInterceptors(
    FileInterceptor('file', {
      fileFilter: pdfFileFilter,
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async reanalyze(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('PDF requis pour re-analyser');
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
      this.creditDetection.scanInBackground(result.statement);
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

function csv(value: string): string {
  // RFC 4180-ish: quote if contains comma, quote, or newline; double internal quotes.
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
