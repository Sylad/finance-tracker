import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AnalysisController } from './analysis.controller';

describe('POST /statements/upload — fichier sauté (L113)', () => {
  it('R2 — un mois déjà importé est journalisé « skipped » avec le relevé existant', async () => {
    const tmp = path.join(process.env.TMPDIR ?? os.tmpdir(), `skip-${Date.now()}.pdf`);
    fs.writeFileSync(tmp, 'x');
    const logs = { log: jest.fn().mockResolvedValue({ id: 'l1' }), update: jest.fn() };
    const storage = { getStatement: jest.fn().mockResolvedValue({ id: '2026-03' }) };
    const analysis = { analyzeAndPersist: jest.fn() };
    const controller = new AnalysisController(
      analysis as never, storage as never, logs as never, { scanInBackground: jest.fn() } as never,
    );
    const res = await controller.upload([
      { originalname: 'releve_2026-03.pdf', path: tmp } as Express.Multer.File,
    ]);
    expect(res.skipped).toEqual([{ filename: 'releve_2026-03.pdf', statementId: '2026-03' }]);
    expect(analysis.analyzeAndPersist).not.toHaveBeenCalled();
    expect(logs.log).toHaveBeenCalledTimes(1);
    expect(logs.log.mock.calls[0][0]).toMatchObject({
      filename: 'releve_2026-03.pdf', status: 'skipped', statementId: '2026-03', statementMonth: 3, statementYear: 2026, durationMs: 0,
    });
    expect(fs.existsSync(tmp)).toBe(false);
  });
});
