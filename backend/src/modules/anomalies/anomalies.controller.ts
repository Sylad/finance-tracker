import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { AnomalyDetectorService } from './anomaly-detector.service';
import { StorageService } from '../storage/storage.service';

@Controller('statements')
export class AnomaliesController {
  constructor(
    private readonly detector: AnomalyDetectorService,
    private readonly storage: StorageService,
  ) {}

  @Get(':id/anomalies')
  async forStatement(@Param('id') id: string) {
    const stmt = await this.storage.getStatement(id);
    if (!stmt) throw new NotFoundException(`Relevé ${id} introuvable`);
    const prevId = previousMonthId(id);
    const prev = prevId ? await this.storage.getStatement(prevId) : null;
    return { anomalies: this.detector.detect(stmt, prev) };
  }
}

function previousMonthId(id: string): string | null {
  const m = id.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  let year = Number(m[1]);
  let month = Number(m[2]) - 1;
  if (month < 1) { month = 12; year -= 1; }
  return `${year}-${String(month).padStart(2, '0')}`;
}
