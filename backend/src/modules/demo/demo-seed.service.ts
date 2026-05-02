import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class DemoSeedService {
  private readonly logger = new Logger(DemoSeedService.name);

  constructor(private readonly config: ConfigService) {}

  private loadFixtures(): Record<string, unknown> {
    const fixturePath = path.join(__dirname, 'demo-fixtures.json');
    return JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as Record<string, unknown>;
  }

  async seed(force = false): Promise<{ seeded: boolean; reason?: string }> {
    const demoDir = path.join(this.config.get<string>('dataDir')!, 'demo');
    const sentinel = path.join(demoDir, '.seeded');
    if (!force && fs.existsSync(sentinel)) {
      return { seeded: false, reason: 'already-seeded' };
    }
    fs.mkdirSync(path.join(demoDir, 'statements', 'archive'), { recursive: true });
    fs.mkdirSync(path.join(demoDir, 'yearly'), { recursive: true });
    fs.mkdirSync(path.join(demoDir, 'uploads'), { recursive: true });

    const f = this.loadFixtures();
    for (const stmt of f.statements as { id: string }[]) {
      fs.writeFileSync(path.join(demoDir, 'statements', `${stmt.id}.json`), JSON.stringify(stmt, null, 2));
    }
    fs.writeFileSync(path.join(demoDir, 'savings-accounts.json'), JSON.stringify(f['savings-accounts'], null, 2));
    fs.writeFileSync(path.join(demoDir, 'loans.json'), JSON.stringify(f.loans, null, 2));
    fs.writeFileSync(path.join(demoDir, 'loan-suggestions.json'), JSON.stringify(f['loan-suggestions'], null, 2));
    fs.writeFileSync(path.join(demoDir, 'declarations.json'), JSON.stringify(f.declarations, null, 2));
    fs.writeFileSync(path.join(demoDir, 'budgets.json'), JSON.stringify(f.budgets, null, 2));
    fs.writeFileSync(sentinel, new Date().toISOString());
    this.logger.log(`Demo seeded at ${demoDir}`);
    return { seeded: true };
  }

  async reset(): Promise<void> {
    const demoDir = path.join(this.config.get<string>('dataDir')!, 'demo');
    if (fs.existsSync(demoDir)) {
      fs.rmSync(demoDir, { recursive: true, force: true });
      this.logger.log(`Demo reset at ${demoDir}`);
    }
  }

  status(): { available: boolean; seeded: boolean } {
    const available = this.config.get<boolean>('demoModeAvailable') ?? true;
    const sentinel = path.join(this.config.get<string>('dataDir')!, 'demo', '.seeded');
    return { available, seeded: fs.existsSync(sentinel) };
  }
}
