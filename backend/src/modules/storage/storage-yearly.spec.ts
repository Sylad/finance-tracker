import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StorageService } from './storage.service';

describe('StorageService — bilan annuel ancien format', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-yearly-'));
    fs.mkdirSync(path.join(dir, 'yearly'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'statements', 'archive', '2025'), { recursive: true });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("recalcule monthlyCashFlow depuis l'archive quand le bilan écrit n'en a pas", async () => {
    fs.writeFileSync(path.join(dir, 'yearly', '2025.json'), JSON.stringify({ year: 2025, scoreProgression: [] }));
    for (const [m, c, d] of [[2, 1500, 1200], [1, 1000, 1100]]) {
      const id = `2025-0${m}`;
      fs.writeFileSync(
        path.join(dir, 'statements', 'archive', '2025', `${id}.json`),
        JSON.stringify({ id, month: m, year: 2025, totalCredits: c, totalDebits: d }),
      );
    }
    const svc = new StorageService({ get: () => dir } as any, { getDataDir: () => dir } as any);
    const one = await svc.getYearlySummary(2025);
    expect(one!.monthlyCashFlow).toEqual([
      { month: 1, credits: 1000, debits: 1100, net: -100 },
      { month: 2, credits: 1500, debits: 1200, net: 300 },
    ]);
    const all = await svc.getAllYearlySummaries();
    expect(all[0].monthlyCashFlow).toHaveLength(2);
  });
});
