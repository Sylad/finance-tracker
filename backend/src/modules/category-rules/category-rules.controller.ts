import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { CategoryRulesService } from './category-rules.service';
import { StorageService } from '../storage/storage.service';
import { validateCategoryRuleInput, validateUserCategoryName } from './dto/category-rule.dto';

@Controller('category-rules')
export class CategoryRulesController {
  constructor(
    private readonly rules: CategoryRulesService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  async list() {
    const [rules, userCategories, available] = await Promise.all([
      this.rules.getAll(),
      this.rules.getUserCategories(),
      this.rules.getAvailableCategories(),
    ]);
    return { rules, userCategories, availableCategories: available };
  }

  @Post()
  async create(@Body() body: unknown) {
    return this.rules.create(validateCategoryRuleInput(body));
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    return this.rules.update(id, validateCategoryRuleInput(body));
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.rules.delete(id);
    return { ok: true };
  }

  @Post('user-categories')
  async addUserCategory(@Body() body: unknown) {
    return this.rules.addUserCategory(validateUserCategoryName(body));
  }

  @Delete('user-categories/:id')
  async deleteUserCategory(@Param('id') id: string) {
    await this.rules.deleteUserCategory(id);
    return { ok: true };
  }

  @Post('replay-all')
  async replayAll() {
    const all = await this.storage.getAllStatements();
    let updated = 0;
    for (const stmt of all) {
      const before = stmt.transactions.map((t) => `${t.id}:${t.category}:${t.subcategory}`).join('|');
      stmt.transactions = await this.rules.apply(stmt.transactions);
      const after = stmt.transactions.map((t) => `${t.id}:${t.category}:${t.subcategory}`).join('|');
      if (before !== after) {
        await this.storage.saveStatement(stmt);
        updated++;
      }
    }
    return { processed: all.length, updated };
  }
}
