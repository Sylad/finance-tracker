import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { DemoSeedService } from './demo-seed.service';
import { RequestDataDirService } from './request-data-dir.service';
import { Loan } from '../../models/loan.model';

/**
 * L147 — le paiement en plusieurs fois de la démo est recalé chaque jour, pas
 * seulement au démarrage du backend, et l'échec du recalage est journalisé.
 */
describe('démo — recalage quotidien du paiement en plusieurs fois (L147)', () => {
  const HOUR = 3_600_000;
  let base: string;
  let service: DemoSeedService;
  const loansFile = () => path.join(base, 'demo', 'loans.json');
  const installment = () =>
    (JSON.parse(fs.readFileSync(loansFile(), 'utf8')) as Loan[]).find((l) => l.kind === 'installment')!;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-installment-daily-'));
    const config = { get: (k: string) => (k === 'dataDir' ? base : undefined) } as unknown as ConfigService;
    service = new DemoSeedService(config, {} as RequestDataDirService);
    jest.useFakeTimers({ now: new Date('2026-10-23T10:00:00Z'), doNotFake: ['nextTick', 'setImmediate', 'setTimeout'] });
  });
  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('R7 — sans redémarrage, le lendemain, la deuxième échéance suit la date du jour', async () => {
    await service.seed();
    service.onApplicationBootstrap();
    jest.setSystemTime(new Date('2026-10-24T10:00:00Z'));
    jest.advanceTimersByTime(HOUR);
    expect(installment().installmentSchedule![1].dueDate).toBe('2026-10-24');
  });

  it('R8 — le recalage se poursuit d’un jour à l’autre et s’arrête à l’extinction du module', async () => {
    await service.seed();
    service.onApplicationBootstrap();
    jest.setSystemTime(new Date('2026-10-24T10:00:00Z'));
    jest.advanceTimersByTime(HOUR);
    jest.setSystemTime(new Date('2026-10-25T10:00:00Z'));
    jest.advanceTimersByTime(HOUR);
    expect(installment().installmentSchedule![1].dueDate).toBe('2026-10-25');
    service.onModuleDestroy();
    jest.setSystemTime(new Date('2026-10-26T10:00:00Z'));
    jest.advanceTimersByTime(HOUR);
    expect(installment().installmentSchedule![1].dueDate).toBe('2026-10-25');
  });

  it('R9 — un échec du recalage (loans.json illisible) est journalisé, pas avalé', async () => {
    await service.seed();
    fs.writeFileSync(loansFile(), '{ pas du json');
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    service.onApplicationBootstrap();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('paiement en plusieurs fois'));
  });

  it('R9 — loans.json absent : même journalisation', async () => {
    await service.seed();
    fs.rmSync(loansFile());
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    service.onApplicationBootstrap();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('paiement en plusieurs fois'));
  });
});
