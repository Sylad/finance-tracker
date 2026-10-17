import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatementDetailPage } from './statement.$id';

const COMMENT = 'Ce mois-ci le solde progresse malgré un loyer élevé, les dépenses courantes restent stables et la trajectoire de l’épargne est positive sur la période.';
const tx = (id: string, amount: number, category: string, description: string) => ({
  id, date: '2025-09-0' + id, description, normalizedDescription: description, amount, category,
  subcategory: category, isRecurring: false,
});
const statement = {
  id: '2025-09', month: 9, year: 2025, bankName: 'LBP', accountHolder: 'Démo', currency: 'EUR',
  openingBalance: 500, closingBalance: 900, totalCredits: 2000, totalDebits: 1600,
  transactions: [
    tx('1', 2000, 'income', 'SALAIRE'),
    tx('2', -800, 'housing', 'LOYER'),
    tx('3', -50, 'other', 'DIVERS'),
  ],
  healthScore: { total: 72, breakdown: {}, trend: 'stable', claudeComment: COMMENT },
  recurringCredits: [],
  analysisNarrative: 'Analyse du mois.',
};

let current: typeof statement = statement;

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: '2025-09' }),
  useNavigate: () => () => {},
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock('@/lib/queries', () => ({
  useStatement: (id?: string) => ({ isLoading: false, data: id === '2025-09' ? current : undefined }),
  useDeleteStatement: () => ({ mutateAsync: async () => {}, isPending: false }),
  useReanalyzeStatement: () => ({ mutateAsync: async () => {}, isPending: false, isError: false }),
}));
vi.mock('@/lib/api', () => ({ api: { get: async () => ({ anomalies: [{ type: 'duplicate', severity: 'info', title: 'Doublon', detail: 'x', transactionIds: [] }] }) } }));
vi.mock('recharts', () => ({
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: () => null, Cell: () => null, Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

async function renderPage() {
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <StatementDetailPage />
    </QueryClientProvider>,
  );
  await screen.findByRole('heading', { level: 2, name: /Anomalies/ });
  return view;
}

describe('StatementDetailPage — accessibilité et lisibilité (L23)', () => {
  afterEach(() => { current = statement; });

  it('un relevé sans transaction ne laisse pas de titre « Qualité de la catégorisation » vide', async () => {
    current = { ...statement, transactions: [] };
    await renderPage();
    expect(screen.queryByRole('heading', { level: 2, name: 'Qualité de la catégorisation' })).toBeNull();
  });

  it('un relevé avec transactions garde ce titre', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { level: 2, name: 'Qualité de la catégorisation' })).toBeTruthy();
  });

  it('t2 — la liste des transactions est focalisable, nommée, sans cadre fixe sous lg', async () => {
    await renderPage();
    const list = screen.getByRole('list', { name: 'Transactions du relevé' });
    expect(list.getAttribute('tabindex')).toBe('0');
    expect(list.className).toMatch(/(^| )lg:overflow-auto( |$)/);
    expect(list.className).toMatch(/(^| )lg:max-h-\[min\(640px,\d+vh\)\]( |$)/);
    expect(list.className).not.toMatch(/(^| )(max-h-|overflow-auto)/);
  });

  it('t3 — filtres et lignes de répartition portent aria-pressed, le compteur est un status', async () => {
    await renderPage();
    const group = screen.getByRole('group', { name: 'Sens des transactions' });
    const all = within(group).getByRole('button', { name: 'Tout' });
    const debit = within(group).getByRole('button', { name: 'Débit' });
    expect(all.getAttribute('aria-pressed')).toBe('true');
    expect(debit.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(debit);
    expect(all.getAttribute('aria-pressed')).toBe('false');
    expect(debit.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toMatch(/2 \/ 3 transactions/);

    const cat = screen.getByRole('button', { name: /Logement.*800/ });
    expect(cat.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(cat);
    expect(cat.getAttribute('aria-pressed')).toBe('true');
  });

  it('t4 — chaque section porte un titre de niveau 2 et les transactions forment une liste', async () => {
    await renderPage();
    const names = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(names).toEqual([
      'Chiffres du mois', 'Qualité de la catégorisation', expect.stringMatching(/^Anomalies détectées/),
      'Répartition des dépenses', 'Transactions', 'Analyse Claude',
    ]);
    const list = screen.getByRole('list', { name: 'Transactions du relevé' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
  });

  it('t6 — l’explication du score s’affiche en entier, sans coupe à trois lignes', async () => {
    await renderPage();
    const text = screen.getByText(COMMENT);
    expect(text.className).not.toMatch(/line-clamp/);
  });

  it('t7 — le champ Filtrer a un nom accessible indépendant de son texte d’aide', async () => {
    await renderPage();
    expect(screen.getByRole('textbox', { name: 'Filtrer les transactions' })).toBeTruthy();
  });
});
