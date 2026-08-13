import { Controller, Get, Post, Query } from '@nestjs/common';
import { ExpensesService } from './expenses.service';

@Controller('expenses')
export class ExpensesController {
  constructor(private readonly svc: ExpensesService) {}

  @Get('breakdown')
  breakdown(@Query('monthId') monthId?: string) {
    return this.svc.getBreakdown(monthId || undefined);
  }

  /** Analyse IA locale (Ollama) des 3 derniers mois — peut durer 1-3 min. */
  @Post('cut-suggestions')
  cutSuggestions() {
    return this.svc.proposeCuts();
  }
}
