import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HistoryPage } from './history';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
const statements = vi.hoisted(() => ({ data: [] as unknown[] }));
vi.mock('@/lib/queries', () => ({
  useStatements: () => ({ isLoading: false, data: statements.data }),
}));

// jsdom n'a pas de mise en page : on verrouille les classes qui évitent le débordement à 390 px.
describe('HistoryPage — barre d’actions au téléphone', () => {
  it('laisse la barre passer à la ligne et le champ de recherche prendre la largeur', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <HistoryPage />
      </QueryClientProvider>,
    );
    const bar = screen.getByRole('button', { name: /Export CSV/ }).parentElement!;
    expect(bar.className).toContain('flex-wrap');
    const input = screen.getByPlaceholderText('Rechercher...');
    expect(input.className).toContain('w-full');
    expect(input.className).toContain('sm:w-64');
    expect(input.className).not.toMatch(/(^|\s)w-64/);
    expect(input.parentElement!.className).toContain('w-full');
  });
});

const row = (id: string, month: number, year: number) => ({
  id, month, year, bankName: 'LBP', accountHolder: 'Démo', totalCredits: 2000, totalDebits: 1500,
  closingBalance: 800, healthScore: 72,
});

function renderWith(data: unknown[]) {
  statements.data = data;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <HistoryPage />
    </QueryClientProvider>,
  );
}

describe('HistoryPage — lisibilité (L23)', () => {
  it('t4 — les relevés d’une année forment une liste ul/li', () => {
    renderWith([row('2025-09', 9, 2025), row('2025-08', 8, 2025)]);
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getAllByRole('listitem')[0].querySelector('a')).not.toBeNull();
  });

  it('t5 — crédits, débits et score portent un sous-libellé visible, icônes masquées', () => {
    renderWith([row('2025-09', 9, 2025)]);
    const item = screen.getByRole('listitem');
    for (const label of [/^crédits$/, /^débits$/, /^score \/100$/]) {
      expect(within(item).getByText(label)).toBeTruthy();
    }
    const svgs = Array.from(item.querySelectorAll('svg'));
    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) expect(svg.getAttribute('aria-hidden')).toBe('true');
  });

  it('t7 — le champ de recherche a un nom accessible indépendant de son texte d’aide', () => {
    renderWith([]);
    expect(screen.getByRole('textbox', { name: 'Rechercher un relevé' })).toBeTruthy();
  });
});
