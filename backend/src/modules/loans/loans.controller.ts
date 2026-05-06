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
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { LoansService } from './loans.service';
import { validateLoanInput } from './dto/loan.dto';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import {
  CreditStatementService,
  CreditStatementParseError,
} from '../analysis/credit-statement.service';
import { MulterExceptionFilter } from '../../filters/multer-exception.filter';

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
    return { loan: updatedLoan, extracted, previous: loan };
  }
}
