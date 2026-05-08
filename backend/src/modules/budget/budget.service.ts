import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { RequestDataDirService } from '../demo/request-data-dir.service';

const BUDGETS_FILE = 'budgets.json';

@Injectable()
export class BudgetService {
  private readonly logger = new Logger(BudgetService.name);

  constructor(private readonly dataDir: RequestDataDirService) {}

  private get filepath(): string {
    return path.resolve(this.dataDir.getDataDir(), BUDGETS_FILE);
  }

  async getBudgets(): Promise<Record<string, number>> {
    try {
      const content = await fs.promises.readFile(this.filepath, 'utf8');
      return JSON.parse(content) as Record<string, number>;
    } catch {
      return {};
    }
  }

  async saveBudgets(budgets: Record<string, number>): Promise<Record<string, number>> {
    const filtered = Object.fromEntries(
      Object.entries(budgets).filter(([, v]) => typeof v === 'number' && v >= 0),
    );
    await fs.promises.writeFile(this.filepath, JSON.stringify(filtered, null, 2), 'utf8');
    this.logger.log('Budgets saved');
    return filtered;
  }
}
