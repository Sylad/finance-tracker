import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { DeclarationsService } from './declarations.service';
import { DEFAULT_FORECAST_MONTHS, FORECAST_HORIZONS, ForecastService } from './forecast.service';
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
  getForecast(@Query('months') months?: string): Promise<ForecastMonth[]> {
    if (months === undefined) return this.forecast.compute(DEFAULT_FORECAST_MONTHS);
    const n = Number(months);
    if (!(FORECAST_HORIZONS as readonly number[]).includes(n)) {
      throw new BadRequestException(`months doit valoir ${FORECAST_HORIZONS.join(', ')}`);
    }
    return this.forecast.compute(n);
  }
}
