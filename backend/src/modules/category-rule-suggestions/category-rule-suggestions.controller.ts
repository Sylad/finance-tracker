import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CategoryRuleSuggestionsService } from './category-rule-suggestions.service';

@Controller('category-rule-suggestions')
export class CategoryRuleSuggestionsController {
  constructor(private readonly service: CategoryRuleSuggestionsService) {}

  @Get()
  async list() {
    const all = await this.service.getAll();
    return { suggestions: all };
  }

  @Get('pending')
  async pending() {
    const suggestions = await this.service.getPending();
    return { suggestions };
  }

  /** Lance une analyse Claude sur les transactions `other`. */
  @Post('generate')
  async generate() {
    return this.service.generateFromOthers();
  }

  @Post(':id/accept')
  async accept(@Param('id') id: string) {
    return this.service.accept(id);
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string) {
    return this.service.reject(id);
  }

  @Post(':id/snooze')
  async snooze(@Param('id') id: string) {
    return this.service.snooze(id);
  }

  @Post(':id/unsnooze')
  async unsnooze(@Param('id') id: string) {
    return this.service.unsnooze(id);
  }

  /** Optional cleanup — rejette en bloc tout ce qui n'est pas encore traité. */
  @Delete('reset-pending')
  async resetPending() {
    const pending = await this.service.getPending();
    for (const s of pending) await this.service.reject(s.id);
    return { rejected: pending.length };
  }
}
