import { BadRequestException, Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { GoalsService } from './goals.service';
import type { GoalInput, GoalType } from '../../models/goal.model';

@Controller('goals')
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Get()
  async list() {
    return this.goals.getAllWithProgress();
  }

  @Post()
  async create(@Body() body: unknown) {
    return this.goals.create(validate(body));
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.goals.delete(id);
    return { ok: true };
  }
}

function validate(raw: unknown): GoalInput {
  if (!raw || typeof raw !== 'object') throw new BadRequestException('Body invalide');
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!name) throw new BadRequestException('name requis');
  if (name.length > 80) throw new BadRequestException('name trop long');
  const type = r.type as GoalType;
  if (type !== 'savings_total' && type !== 'net_worth') throw new BadRequestException('type invalide');
  const targetAmount = Number(r.targetAmount);
  if (!Number.isFinite(targetAmount) || targetAmount <= 0) throw new BadRequestException('targetAmount invalide');
  const targetDate = typeof r.targetDate === 'string' && r.targetDate.trim()
    ? r.targetDate.trim()
    : null;
  if (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) throw new BadRequestException('targetDate doit être YYYY-MM-DD');
  const startAmount = r.startAmount !== undefined ? Number(r.startAmount) : undefined;
  if (startAmount !== undefined && !Number.isFinite(startAmount)) throw new BadRequestException('startAmount invalide');
  return { name, type, targetAmount, targetDate, startAmount };
}
