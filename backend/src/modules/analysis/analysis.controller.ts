import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
  UnprocessableEntityException,
  Logger,
  UseFilters,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { AnalysisService } from './analysis.service';
import { AnthropicParseError } from './anthropic.service';
import { MulterExceptionFilter } from '../../filters/multer-exception.filter';
import { AnalysisResponse } from '../../models/monthly-statement.model';
import { StorageService } from '../storage/storage.service';
import { ImportLogsService } from '../import-logs/import-logs.service';

// Detects only the unambiguous YYYY-MM pattern (real period).
// YYYYMMDD/YYYYMM patterns were removed: bank PDFs (e.g. La Banque Postale) are named by
// issue date (~9 days into the month FOLLOWING the period), so those patterns triggered
// false-positive duplicate skips. Files without a YYYY-MM hint are sent to the AI, which
// reads the actual period from the PDF content.
function extractMonthFromFilename(filename: string): string | null {
  const m = filename.match(/(\d{4})-(0[1-9]|1[0-2])/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  if (year < 2000 || year > 2100) return null;
  return `${year}-${m[2]}`;
}

@Controller('statements')
@UseFilters(MulterExceptionFilter)
export class AnalysisController {
  private readonly logger = new Logger(AnalysisController.name);

  constructor(
    private readonly analysisService: AnalysisService,
    private readonly storage: StorageService,
    private readonly importLogs: ImportLogsService,
  ) {}

  @Post('upload')
  @UseInterceptors(
    FilesInterceptor('files', 12, {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadDir = path.resolve(process.cwd(), './data/uploads');
          cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
          cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
          return cb(new BadRequestException('Seuls les fichiers PDF sont acceptés'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async upload(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files || files.length === 0) {
      throw new BadRequestException('Aucun fichier fourni');
    }

    const results: Array<{
      filename: string;
      response?: AnalysisResponse;
      skipped?: string;   // statement id if skipped as duplicate
      error?: string;
    }> = [];

    for (const file of files) {
      // --- Duplicate check from filename (free, no API call) ---
      const detectedId = extractMonthFromFilename(file.originalname);
      if (detectedId) {
        const existing = await this.storage.getStatement(detectedId);
        if (existing) {
          await this.cleanupFile(file.path);
          results.push({ filename: file.originalname, skipped: detectedId });
          this.logger.log(`Skipped ${file.originalname} — ${detectedId} already exists`);
          continue;
        }
      }

      // --- Read buffer then delete temp file ---
      let pdfBuffer: Buffer;
      try {
        pdfBuffer = await fs.promises.readFile(file.path);
      } catch {
        results.push({ filename: file.originalname, error: 'Impossible de lire le fichier' });
        continue;
      } finally {
        await this.cleanupFile(file.path);
      }

      // --- Analyse via Claude ---
      const startedAt = Date.now();
      const uploadedAt = new Date().toISOString();
      // Log immédiat avec status=in-progress pour donner du retour live à l'UI
      const pendingLog = await this.importLogs.log({
        filename: file.originalname,
        uploadedAt,
        durationMs: 0,
        status: 'in-progress',
      });
      try {
        const response = await this.analysisService.analyzeAndPersist(pdfBuffer);
        await this.importLogs.update(pendingLog.id, {
          durationMs: Date.now() - startedAt,
          status: 'success',
          statementId: response.statement.id,
          statementMonth: response.statement.month,
          statementYear: response.statement.year,
          replaced: response.replaced,
        });
        results.push({ filename: file.originalname, response });
        this.logger.log(`Processed ${file.originalname} → ${response.statement.id} (replaced=${response.replaced})`);
      } catch (e) {
        const message =
          e instanceof AnthropicParseError
            ? `Analyse échouée : ${e.message}`
            : 'Erreur inattendue lors de l\'analyse';
        await this.importLogs.update(pendingLog.id, {
          durationMs: Date.now() - startedAt,
          status: 'error',
          error: message,
        });
        results.push({ filename: file.originalname, error: message });
        this.logger.error(`Failed ${file.originalname}`, e);
      }
    }

    const succeeded = results.filter((r) => r.response);
    const skipped = results.filter((r) => r.skipped);
    const failed = results.filter((r) => r.error);

    if (succeeded.length === 0 && skipped.length === 0) {
      throw new UnprocessableEntityException({
        message: 'Aucun relevé n\'a pu être analysé',
        errors: failed.map((r) => ({ filename: r.filename, error: r.error })),
      });
    }

    return {
      succeeded: succeeded.map((r) => ({
        statement: r.response!.statement,
        replaced: r.response!.replaced,
        filename: r.filename,
      })),
      skipped: skipped.map((r) => ({ filename: r.filename, statementId: r.skipped! })),
      failed: failed.map((r) => ({ filename: r.filename, error: r.error })),
    };
  }

  private async cleanupFile(filePath: string): Promise<void> {
    try {
      await fs.promises.unlink(filePath);
    } catch {
      // already deleted or missing
    }
  }
}
