import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { DeclarationsService } from './declarations.service';
import { ForecastService } from './forecast.service';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { DeclarationInputSchema } from './declarations.schema';
import type { Declaration, DeclarationInput, ForecastMonth } from '../../models/declaration.model';

@Controller()
export class DeclarationsController {
  constructor(
    private readonly declarations: DeclarationsService,
    private readonly forecast: ForecastService,
  ) {}

  @Get('declarations')
  list(): Promise<Declaration[]> {
    return this.declarations.getAll();
  }

  @Post('declarations')
  create(@Body(new ZodValidationPipe(DeclarationInputSchema)) body: DeclarationInput): Promise<Declaration> {
    return this.declarations.create(body);
  }

  @Put('declarations/:id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(DeclarationInputSchema)) body: DeclarationInput,
  ): Promise<Declaration> {
    return this.declarations.update(id, body);
  }

  @Delete('declarations/:id')
  @HttpCode(204)
  async delete(@Param('id') id: string): Promise<void> {
    await this.declarations.delete(id);
  }

  @Get('forecast')
  getForecast(): Promise<ForecastMonth[]> {
    return this.forecast.compute();
  }
}
