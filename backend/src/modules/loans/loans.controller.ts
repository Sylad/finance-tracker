import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Logger,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UploadedFiles,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { LoansService } from './loans.service';
import { validateLoanInput } from './dto/loan.dto';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import {
  CreditStatementService,
  CreditStatementParseError,
} from '../analysis/credit-statement.service';
import {
  AmortizationService,
  AmortizationParseError,
} from '../analysis/amortization.service';
import { ImportOrchestratorService } from './import-orchestrator.service';
import { RequestDataDirService } from '../demo/request-data-dir.service';
import { MulterExceptionFilter } from '../../filters/multer-exception.filter';
import { Loan } from '../../models/loan.model';

const ResetRevolvingSchema = z.object({ usedAmount: z.number().nonnegative() });

const MergeDuplicatesSchema = z.object({
  canonicalId: z.string().min(1),
  duplicateIds: z.array(z.string().min(1)).min(1),
});

const CleanupSuspiciousSchema = z.object({
  loanIds: z.array(z.string().min(1)).min(1),
});

@Controller('loans')
@UseFilters(MulterExceptionFilter)
export class LoansController {
  private readonly logger = new Logger(LoansController.name);

  constructor(
    private readonly svc: LoansService,
    private readonly creditStatement: CreditStatementService,
    private readonly amortization: AmortizationService,
    private readonly orchestrator: ImportOrchestratorService,
    private readonly dataDir: RequestDataDirService,
  ) {}

  @Get()
  async list() {
    const all = await this.svc.getAll();
    return all.map((l) => ({ ...l, health: LoansService.getLoanHealth(l) }));
  }

  @Get('duplicates')
  detectDuplicates() {
    return this.svc.detectDuplicates();
  }

  @Get('suspicious')
  getSuspicious() {
    return this.svc.getSuspiciousLoans();
  }

  @Post('cleanup-suspicious')
  cleanupSuspicious(
    @Body(new ZodValidationPipe(CleanupSuspiciousSchema))
    body: { loanIds: string[] },
  ) {
    return this.svc.cleanupSuspiciousLoans(body.loanIds);
  }

  @Post(':id/convert-to-installment')
  convertToInstallment(@Param('id') id: string) {
    return this.svc.convertToInstallment(id);
  }

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
  reset(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ResetRevolvingSchema)) body: { usedAmount: number },
  ) {
    return this.svc.resetRevolving(id, body.usedAmount);
  }

  @Post(':id/split-by-amount')
  split(@Param('id') id: string) {
    return this.svc.splitByAmount(id);
  }

  @Post('merge-duplicates')
  mergeDuplicates(
    @Body(new ZodValidationPipe(MergeDuplicatesSchema))
    body: { canonicalId: string; duplicateIds: string[] },
  ) {
    return this.svc.mergeDuplicates(body.canonicalId, body.duplicateIds);
  }

  /**
   * Importe un tableau d'amortissement (PDF) d'un crédit classique.
   * Si `attachToLoanId` est fourni → applique au Loan existant.
   * Sinon → crée un nouveau Loan classic pré-rempli puis applique.
   *
   * Bypass démo : 403 (consomme des tokens API, pas en démo Cloudflare).
   */
  @Post('import-amortization')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (_req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
          return cb(new BadRequestException('Seuls les fichiers PDF sont acceptés'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async importAmortization(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('attachToLoanId') attachToLoanId?: string,
  ): Promise<Loan> {
    if (this.dataDir.isDemoMode()) {
      throw new ForbiddenException("Mode démo : import d'amortissement désactivé");
    }
    if (!file) {
      throw new BadRequestException('Aucun fichier fourni');
    }
    let extracted;
    try {
      extracted = await this.amortization.analyzeAmortization(file.buffer);
    } catch (err) {
      if (err instanceof AmortizationParseError) {
        throw new BadRequestException(`Analyse échouée : ${err.message}`);
      }
      throw err;
    }

    // Délégué à ImportOrchestratorService — find-or-create via signals,
    // ou apply direct si attachToLoanId fourni.
    const result = await this.orchestrator.importAmortization(extracted, attachToLoanId);
    if (result.created) {
      this.logger.log(`[amortization-auto] Created loan ${result.loan.id} (${extracted.creditor}, ${extracted.initialPrincipal}€)`);
    } else {
      this.logger.log(`[amortization-auto] Matched loan ${result.loan.id} (${result.matchReason ?? 'unknown'})`);
    }
    return result.loan;
  }

  @Post(':id/import-statement')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (_req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
          return cb(new BadRequestException('Seuls les fichiers PDF sont acceptés'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async importStatement(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException('Aucun fichier fourni');
    const loan = await this.svc.getOne(id);
    let extracted;
    try {
      extracted = await this.creditStatement.analyzeCreditStatement(file.buffer);
    } catch (err) {
      if (err instanceof CreditStatementParseError) {
        throw new BadRequestException(`Analyse échouée : ${err.message}`);
      }
      throw err;
    }
    this.logger.log(
      `Imported credit statement for ${id} (creditor=${extracted.creditor}, type=${extracted.creditType}, balance=${extracted.currentBalance})`,
    );
    const updatedLoan = await this.svc.applyStatementSnapshot(id, extracted);
    // Ajoute aussi une occurrence depuis le relevé crédit (mensualité du
    // mois extrait) — elle sera dédupée si la même mensualité existe déjà
    // depuis un relevé bancaire. Source 'credit_statement' = priorité
    // supérieure → remplace l'éventuelle bank_statement existante.
    if (extracted.statementDate && extracted.monthlyPayment > 0) {
      const occStatementId = `credit-${id}-${extracted.statementDate.slice(0, 7)}`;
      await this.svc.addOccurrence(id, {
        statementId: occStatementId,
        date: extracted.statementDate,
        amount: -Math.abs(extracted.monthlyPayment),
        transactionId: null,
        description: `Relevé crédit ${extracted.creditor} ${extracted.statementDate}`,
        source: 'credit_statement',
      });
    }
    return { loan: updatedLoan, extracted, previous: loan };
  }

  /**
   * Import auto multi-PDF de relevés de crédit. Pour chaque PDF :
   *   1. Analyse via Claude (CreditStatementService) → extrait creditor,
   *      monthlyPayment, currentBalance, accountNumber, statementDate.
   *   2. Tente de matcher un Loan existant via le contractRef ↔ accountNumber.
   *   3. Si trouvé : applique le snapshot + ajoute occurrence credit_statement.
   *   4. Si pas trouvé : crée un nouveau Loan avec contractRef = accountNumber
   *      pré-rempli, puis applique le snapshot. L'utilisateur pourra l'éditer.
   *
   * Résout AC1 + AC2 : un PDF de relevé de crédit ajouté est reconnu par
   * son N° de compte, sans intervention manuelle pour choisir le Loan.
   */
  @Post('import-credit-statements')
  @UseInterceptors(
    FilesInterceptor('files', 12, {
      storage: memoryStorage(),
      fileFilter: (_req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
          return cb(new BadRequestException('Seuls les fichiers PDF sont acceptés'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async importCreditStatementsAuto(
    @UploadedFiles() files: Express.Multer.File[] | undefined,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('Aucun fichier fourni');
    }
    const results: Array<{
      filename: string;
      loanId?: string;
      created?: boolean;
      matched?: boolean;
      creditor?: string;
      accountNumber?: string | null;
      rumNumber?: string | null;
      monthlyPayment?: number;
      error?: string;
    }> = [];
    for (const file of files) {
      try {
        const extracted = await this.creditStatement.analyzeCreditStatement(file.buffer);
        // Délégué à ImportOrchestratorService : findExistingLoan en first-class
        // (même matcher unifié que les 2 autres paths).
        const result = await this.orchestrator.importCreditStatement(extracted);
        const updated = result.loan;
        const matched = !result.created;

        // Ajoute l'occurrence canonique du mois (source: 'credit_statement')
        if (extracted.statementDate && extracted.monthlyPayment > 0) {
          const occStatementId = `credit-${updated.id}-${extracted.statementDate.slice(0, 7)}`;
          await this.svc.addOccurrence(updated.id, {
            statementId: occStatementId,
            date: extracted.statementDate,
            amount: -Math.abs(extracted.monthlyPayment),
            transactionId: null,
            description: `Relevé crédit ${extracted.creditor} ${extracted.statementDate}`,
            source: 'credit_statement',
          });
        }
        results.push({
          filename: file.originalname,
          loanId: updated.id,
          created: !matched,
          matched,
          creditor: extracted.creditor,
          accountNumber: extracted.accountNumber,
          rumNumber: extracted.rumNumber,
          monthlyPayment: extracted.monthlyPayment,
        });
        const idDisplay = extracted.accountNumber
          ? `#${extracted.accountNumber}`
          : extracted.rumNumber
            ? `RUM:${extracted.rumNumber}`
            : '?';
        this.logger.log(
          `[credit-auto] ${file.originalname} → ${matched ? 'matched' : 'CREATED'} loan ${updated.id} (${extracted.creditor} ${idDisplay})`,
        );
      } catch (err) {
        const message =
          err instanceof CreditStatementParseError
            ? `Analyse échouée : ${err.message}`
            : 'Erreur inattendue lors de l\'analyse';
        results.push({ filename: file.originalname, error: message });
        this.logger.error(`[credit-auto] ${file.originalname} failed`, err);
      }
    }
    return { results };
  }
}
