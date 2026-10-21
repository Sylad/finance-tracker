import { BadRequestException } from '@nestjs/common';
import { ForecastService } from './forecast.service';
import { DeclarationsController } from './declarations.controller';

function makeService(loans: unknown[] = []): ForecastService {
  return new ForecastService(
    { getAll: async () => [] } as never,
    {
      getAllStatements: async () => [],
      getAggregatedRecurringCredits: async () => [],
    } as never,
    { getAll: async () => loans } as never,
    { getAll: async () => [] } as never,
  );
}

describe('Prévisions : fenêtre 3/6/12 mois', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 10, 15));
  });
  afterEach(() => jest.useRealTimers());

  it.each([3, 6, 12])('R1 — %i mois : la fenêtre commence au mois courant et compte %i mois', async (n) => {
    const out = await makeService().compute(n);
    expect(out).toHaveLength(n);
    expect(out[0].month).toBe('2026-11');
    const last = new Date(2026, 10 + n - 1, 1);
    expect(out[n - 1].month).toBe(`${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}`);
  });

  it('R2 — sans paramètre, la fenêtre est de 12 mois à partir du mois courant', async () => {
    const out = await makeService().compute();
    expect(out.map((m) => m.month)[0]).toBe('2026-11');
    expect(out).toHaveLength(12);
  });

  it('R3 — le contrôleur transmet ?months au calcul', async () => {
    const compute = jest.fn(async () => []);
    const ctrl = new DeclarationsController({} as never, { compute } as never);
    await ctrl.getForecast('6');
    expect(compute).toHaveBeenCalledWith(6);
    await ctrl.getForecast(undefined);
    expect(compute).toHaveBeenLastCalledWith(12);
  });

  it('R4 — un ?months hors 3/6/12 est refusé (400)', () => {
    const ctrl = new DeclarationsController({} as never, { compute: jest.fn() } as never);
    expect(() => ctrl.getForecast('7')).toThrow(BadRequestException);
    expect(() => ctrl.getForecast('abc')).toThrow(BadRequestException);
  });
});

describe('Prévisions : libellé des crédits (L93)', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 10, 15));
  });
  afterEach(() => jest.useRealTimers());

  const loan = (name: string) => ({
    id: 'l1', name, isActive: true, monthlyPayment: 240, category: 'consumer', startDate: null, endDate: null,
  });

  it('R1 — le montant au point décimal « (240.00 €/mois) » du nom du prêt n\'est pas repris dans le libellé', async () => {
    const out = await makeService([loan('CETELEM (240.00 €/mois)')]).compute(3);
    const occ = out[0].occurrences.find((o) => o.type === 'loan');
    expect(occ?.label).toBe('CETELEM');
    expect(occ?.amountSigned).toBe(-240);
  });

  it('L94 — le suffixe de sous-crédit fr-FR « (240,00 €/mois · …1234) » n\'est pas repris dans le libellé', async () => {
    const out = await makeService([loan('CETELEM (240,00 €/mois · …1234)')]).compute(3);
    expect(out[0].occurrences.find((o) => o.type === 'loan')?.label).toBe('CETELEM');
  });

  it('L94 — le suffixe au point décimal avec référence « (240.00 €/mois · …1234) » est retiré aussi', async () => {
    const out = await makeService([loan('CETELEM (240.00 €/mois · …1234)')]).compute(3);
    expect(out[0].occurrences.find((o) => o.type === 'loan')?.label).toBe('CETELEM');
  });

  it('R2 — un nom de prêt sans montant reste inchangé', async () => {
    const out = await makeService([loan('CETELEM (prêt auto)')]).compute(3);
    expect(out[0].occurrences.find((o) => o.type === 'loan')?.label).toBe('CETELEM (prêt auto)');
  });
});
