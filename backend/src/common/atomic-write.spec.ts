import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { atomicWriteJson } from './atomic-write';

describe('atomicWriteJson — écritures concurrentes (bug import-logs 2026-08-13)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('N écritures parallèles du même fichier réussissent toutes et la dernière gagne', async () => {
    const file = path.join(dir, 'import-logs.json');
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => atomicWriteJson(file, { seq: i })),
    );
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(parsed).toEqual({ seq: 19 });
    // Aucun tmp orphelin
    expect(fs.readdirSync(dir)).toEqual(['import-logs.json']);
  });

  it('les écritures vers des fichiers différents restent indépendantes', async () => {
    const a = path.join(dir, 'a.json');
    const b = path.join(dir, 'b.json');
    await Promise.all([atomicWriteJson(a, { v: 'a' }), atomicWriteJson(b, { v: 'b' })]);
    expect(JSON.parse(fs.readFileSync(a, 'utf8'))).toEqual({ v: 'a' });
    expect(JSON.parse(fs.readFileSync(b, 'utf8'))).toEqual({ v: 'b' });
  });
});
