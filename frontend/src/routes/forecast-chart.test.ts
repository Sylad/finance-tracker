import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { forecastChartData, forecastTooltipFormatter } from './forecast-chart';

const months = [{ month: '2026-11', income: 3000.5, expense: 932.35, net: 2068.15, occurrences: [] }];

describe('Prévisions — graphe : montants exacts et solde (L90)', () => {
  const source = readFileSync('src/routes/forecast.tsx', 'utf8');

  it('R1 — l\'axe Y utilise formatEURCompact (« 2 k » pas « 2k » écrit à la main)', () => {
    expect(source).toContain('tickFormatter={formatEURCompact}');
    expect(source).not.toContain('toFixed(0)');
  });

  it('R2 — les données du graphe gardent les centimes (2 068,15 € et non 2 068,00 €)', () => {
    const [d] = forecastChartData(months);
    expect(d.income).toBe(3000.5);
    expect(d.expense).toBe(-932.35);
    expect(d.net).toBe(2068.15);
  });

  it('R3 — l\'info-bulle affiche le montant exact en valeur absolue', () => {
    expect(forecastTooltipFormatter(-932.35, 'Dépenses')[0]).toMatch(/932,35/);
    expect(forecastTooltipFormatter(2068.15, 'Solde')[0]).toMatch(/2\s068,15/);
    expect(forecastTooltipFormatter(2068.15, 'Solde')[1]).toBe('Solde');
  });

  it('R3b — un solde négatif garde son signe dans l\'info-bulle', () => {
    expect(forecastTooltipFormatter(-120.5, 'Solde')[0]).toMatch(/-120,50|−120,50/);
  });

  it('R4 — le solde mensuel est tracé (série « Solde » sur le graphe)', () => {
    expect(source).toMatch(/<Line[^>]*dataKey="net"[^>]*name="Solde"/);
  });
});
