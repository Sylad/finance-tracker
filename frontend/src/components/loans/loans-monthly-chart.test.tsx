import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { Loan } from '@/types/api';
import { LoansMonthlyChart } from './loans-monthly-chart';
import { chartSeriesNames } from './utils';
import { formatEURCompact } from '@/lib/utils';

function monthKey(offset: number): string {
  const d = new Date(new Date().getFullYear(), new Date().getMonth() - offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function loan(id: string, name: string, creditor: string, amounts: number[]): Loan {
  return {
    id,
    name,
    creditor,
    occurrencesDetected: amounts.map((a, i) => ({ date: `${monthKey(i)}-05`, amount: -a, source: 'bank_statement' })),
  } as unknown as Loan;
}

const cofidisA = loan('a', 'Cofidis 4XCB Fnac', 'COFIDIS', [100, 100]);
const cofidisB = loan('b', 'Cofidis Prêt auto', 'COFIDIS', [250]);
const bnp = loan('c', 'BNP IMMOBILIER', 'BNP PARIBAS PERSONAL FINANCE', [1100]);

describe('Crédits — graphe des mensualités (L136, WCAG 1.4.1 / 1.1.1)', () => {
  it('R1 — chaque série porte le nom du crédit comme sur la carte, pas le créancier', () => {
    const noms = chartSeriesNames([cofidisA, cofidisB, bnp]);
    expect(noms.get('a')).toBe('Cofidis 4XCB Fnac');
    expect(noms.get('b')).toBe('Cofidis Prêt auto');
    expect(noms.get('c')).toBe('BNP IMMOBILIER');
  });

  it('R2 — deux crédits de même nom restent distincts sans la couleur', () => {
    const noms = chartSeriesNames([loan('x', 'COFIDIS', 'COFIDIS', [10]), loan('y', 'COFIDIS', 'COFIDIS', [20])]);
    expect(new Set(noms.values()).size).toBe(2);
    expect(noms.get('x')).toBe('COFIDIS (1)');
    expect(noms.get('y')).toBe('COFIDIS (2)');
  });

  it('R3 — le graphique est une image avec une alternative texte de synthèse', () => {
    render(<LoansMonthlyChart loans={[cofidisA, cofidisB, bnp]} />);
    const img = screen.getByRole('img');
    const label = img.getAttribute('aria-label') ?? '';
    expect(label).toContain('3 crédits');
    expect(label).toContain('12 derniers mois');
    expect(label).toContain('BNP IMMOBILIER');
  });

  it('R4 — un tableau masqué donne les montants par mois et par crédit', () => {
    render(<LoansMonthlyChart loans={[cofidisA, cofidisB, bnp]} />);
    const table = screen.getByRole('table', { name: /charge crédits/i });
    expect(within(table).getByRole('columnheader', { name: 'Cofidis Prêt auto' })).toBeTruthy();
    expect(within(table).getAllByRole('row')).toHaveLength(13);
    expect((table.textContent ?? '').replace(/\s/g, ' ')).toContain('1 100,00');
    expect(table.closest('[role="img"]')).toBeNull();
    expect(table.parentElement?.className).toContain('sr-only');
  });

  it('R6 — un mois sans relevé et sans mensualité s\'écrit « — » et se signale, jamais « 0,00 € »', () => {
    // relevés seulement pour le mois courant et le précédent : les autres mois sont hors relevés
    const couverts = new Set([monthKey(0), monthKey(1)]);
    render(<LoansMonthlyChart loans={[cofidisA]} statementMonths={couverts} />);
    const table = screen.getByRole('table', { name: /charge crédits/i });
    const rows = within(table).getAllByRole('row').slice(1);
    const cellules = rows.map((r) => within(r).getAllByRole('cell')[0].textContent);
    expect(cellules.filter((c) => c === '—')).toHaveLength(10);
    expect(cellules.some((c) => /^0,00/.test(c ?? ''))).toBe(false);
    expect(within(rows[0]).getByRole('rowheader').textContent).toContain('sans relevé');
    expect(within(rows[11]).getByRole('rowheader').textContent).not.toContain('sans relevé');
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('10 mois sans relevé');
  });

  it('R7 — un mois couvert par un relevé sans mensualité garde « 0,00 € »', () => {
    const couverts = new Set(Array.from({ length: 12 }, (_, i) => monthKey(i)));
    render(<LoansMonthlyChart loans={[cofidisB]} statementMonths={couverts} />);
    const table = screen.getByRole('table', { name: /charge crédits/i });
    expect((table.textContent ?? '').replace(/\s/g, ' ')).toContain('0,00');
    expect(table.textContent).not.toContain('—');
  });

  it('R8 — tant que les relevés ne sont pas chargés, aucun mois n\'est signalé', () => {
    render(<LoansMonthlyChart loans={[cofidisA]} />);
    const table = screen.getByRole('table', { name: /charge crédits/i });
    expect(table.textContent).not.toContain('sans relevé');
  });

  it('R5 — l\'axe Y s\'écrit en fr-FR : « 1 100 € »', () => {
    expect(formatEURCompact(1100).replace(/\s/g, ' ')).toBe('1 100 €');
  });
});

vi.mock('recharts', async (orig) => {
  const m = await orig<typeof import('recharts')>();
  return { ...m, ResponsiveContainer: () => null };
});
