import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  Post,
  Put,
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
import { MulterExceptionFilter } from '../../filters/multer-exception.filter';
import { Loan } from '../../models/loan.model';

const ResetRevolvingSchema = z.object({ usedAmount: z.number().nonnegative() });

@Controller('loans')
@UseFilters(MulterExceptionFilter)
export class LoansController {
  private readonly logger = new Logger(LoansController.name);

  constructor(
    private readonly svc: LoansService,
    private readonly creditStatement: CreditStatementService,
  ) {}

  @Get()
  list() { return this.svc.getAll(); }

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
      monthlyPayment?: number;
      error?: string;
    }> = [];
    for (const file of files) {
      try {
        const extracted = await this.creditStatement.analyzeCreditStatement(file.buffer);
        let loan = extracted.accountNumber
          ? await this.svc.findByAccountNumber(extracted.accountNumber)
          : null;
        const matched = loan != null;
        if (!loan) {
          // Crée un nouveau Loan pré-rempli avec les valeurs extraites
          const now = new Date().toISOString();
          const baseName = `${extracted.creditor}${extracted.accountNumber ? ` · ${extracted.accountNumber.slice(-4)}` : ''}`;
          const newLoan: Loan = {
            id: randomUUID(),
            name: baseName,
            type: extracted.creditType,
            category: 'consumer',
            monthlyPayment: extracted.monthlyPayment,
            matchPattern: extracted.creditor,
            isActive: true,
            creditor: extracted.creditor,
            contractRef: extracted.accountNumber ?? undefined,
            startDate: extracted.statementDate,
            endDate: extracted.endDate ?? undefined,
            maxAmount: extracted.creditType === 'revolving' ? extracted.maxAmount : undefined,
            usedAmount: extracted.creditType === 'revolving' ? Math.max(0, extracted.currentBalance) : undefined,
            occurrencesDetected: [],
            createdAt: now,
            updatedAt: now,
          };
          loan = await this.svc.create({
            name: newLoan.name,
            type: newLoan.type,
            category: newLoan.category,
            monthlyPayment: newLoan.monthlyPayment,
            matchPattern: newLoan.matchPattern,
            isActive: newLoan.isActive,
            creditor: newLoan.creditor,
            contractRef: newLoan.contractRef,
            startDate: newLoan.startDate,
            endDate: newLoan.endDate,
            maxAmount: newLoan.maxAmount,
            usedAmount: newLoan.usedAmount,
          });
        }
        const updated = await this.svc.applyStatementSnapshot(loan.id, extracted);
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
          monthlyPayment: extracted.monthlyPayment,
        });
        this.logger.log(
          `[credit-auto] ${file.originalname} → ${matched ? 'matched' : 'CREATED'} loan ${updated.id} (${extracted.creditor} #${extracted.accountNumber ?? '?'})`,
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
