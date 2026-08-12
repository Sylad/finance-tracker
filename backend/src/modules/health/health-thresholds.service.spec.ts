import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HealthThresholdsService } from './health-thresholds.service';
import { RequestDataDirService } from '../demo/request-data-dir.service';
import { DEFAULT_THRESHOLDS } from '../../models/health.model';

describe('HealthThresholdsService', () => {
  let svc: HealthThresholdsService;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-health-'));
    const dataDir = { getDataDir: () => tmpDir } as unknown as RequestDataDirService;
    svc = new HealthThresholdsService(dataDir);
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('retourne les défauts quand le fichier est absent', async () => {
    expect(await svc.get()).toEqual(DEFAULT_THRESHOLDS);
  });

  it('update partiel : merge sur les défauts et persiste', async () => {
    const out = await svc.update({ tauxEffort: { orangeAbovePct: 30, redAbovePct: 45 } });
    expect(out.tauxEffort.redAbovePct).toBe(45);
    expect(out.plafonds).toEqual(DEFAULT_THRESHOLDS.plafonds); // non touché
    expect((await svc.get()).tauxEffort.orangeAbovePct).toBe(30); // relu depuis disque
  });

  it('fichier partiel sur disque : les clés manquantes reprennent les défauts', async () => {
    fs.writeFileSync(path.join(tmpDir, 'health-thresholds.json'),
      JSON.stringify({ manualMonthlyIncome: 2500 }));
    const out = await svc.get();
    expect(out.manualMonthlyIncome).toBe(2500);
    expect(out.tauxEffort).toEqual(DEFAULT_THRESHOLDS.tauxEffort);
  });

  it('reset restaure les défauts', async () => {
    await svc.update({ manualMonthlyIncome: 9999 });
    expect(await svc.reset()).toEqual(DEFAULT_THRESHOLDS);
    expect(await svc.get()).toEqual(DEFAULT_THRESHOLDS);
  });

  it('update partiel deep-merge : garde les valeurs non-omises de la section', async () => {
    // Setup: seuils custom persistés
    await svc.update({ tauxEffort: { orangeAbovePct: 30, redAbovePct: 45 } });
    // Verify setup
    let current = await svc.get();
    expect(current.tauxEffort).toEqual({ orangeAbovePct: 30, redAbovePct: 45 });

    // Update partiel : on change seulement redAbovePct
    const out = await svc.update({ tauxEffort: { redAbovePct: 40 } });
    // Attendu : orangeAbovePct reste 30, redAbovePct change à 40 (pas revert aux défauts)
    expect(out.tauxEffort).toEqual({ orangeAbovePct: 30, redAbovePct: 40 });
    // Vérifier persistence
    current = await svc.get();
    expect(current.tauxEffort).toEqual({ orangeAbovePct: 30, redAbovePct: 40 });
  });
});
