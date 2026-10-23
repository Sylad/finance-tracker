import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SavingsPage } from './savings';
import type { SavingsAccount } from '@/types/api';

const account = (o: Partial<SavingsAccount>): SavingsAccount => ({
  id: 'a', name: 'Livret A', type: 'livret-a', initialBalance: 100, initialBalanceDate: '2026-01-01',
  matchPattern: '', accountNumber: '', interestRate: 0.015, interestAnniversaryMonth: 12,
  currentBalance: 100, movements: [], ...o,
} as SavingsAccount);

const state = vi.hoisted(() => ({ items: [] as unknown[], hist: [] as { month: string; balance: number }[] }));
const idle = { mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false };

vi.mock('@/lib/queries', () => ({
  useSavingsAccounts: () => ({ data: state.items, isLoading: false }),
  useCreateSavingsAccount: () => idle,
  useUpdateSavingsAccount: () => idle,
  useDeleteSavingsAccount: () => idle,
  useSavingsHistory: () => ({ data: state.hist }),
  useResyncSavings: () => idle,
}));

describe('<SavingsPage /> — noms accessibles (L116)', () => {
  it('R1 — chaque carte a des boutons « Modifier <compte> » et « Supprimer <compte> »', () => {
    state.items = [account({ id: 'a', name: 'Livret A' }), account({ id: 'b', name: 'PEL Papa' })];
    render(<SavingsPage />);
    for (const name of ['Livret A', 'PEL Papa']) {
      expect(screen.getByRole('button', { name: `Modifier ${name}` })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: `Supprimer ${name}` })).toBeInTheDocument();
    }
  });

  it('R2 — le × de la fenêtre de saisie se nomme « Fermer » et la ferme', async () => {
    state.items = [account({})];
    render(<SavingsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter un compte' }));
    await userEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByText('Nouveau compte épargne')).not.toBeInTheDocument();
  });
});

describe('<SavingsPage /> — courbe de la carte (L119)', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

  const hist = [
    { month: '2026-01', balance: 0 }, { month: '2026-02', balance: 0 },
    { month: '2026-03', balance: 1000 }, { month: '2026-04', balance: 1500 },
  ];

  it("R6 — la courbe porte un résumé en texte : période, montant de début et de fin", () => {
    state.items = [account({ initialBalanceDate: '2026-03-01' })];
    state.hist = hist;
    render(<SavingsPage />);
    const img = screen.getByRole('img', { name: /Livret A/ });
    const label = img.getAttribute('aria-label') ?? '';
    expect(label).toMatch(/mars 2026/);
    expect(label).toMatch(/avril 2026/);
    expect(label).toMatch(/1\s?000,00/);
    expect(label).toMatch(/1\s?500,00/);
  });

  it("R7 — « 12 derniers mois » est écrit quand le compte a plus d'un an, « depuis <mois> » sinon", () => {
    state.items = [account({ initialBalanceDate: '2026-03-01' })];
    state.hist = hist;
    const { unmount } = render(<SavingsPage />);
    expect(screen.getByText(/Depuis mars 2026/)).toBeInTheDocument();
    unmount();
    state.items = [account({ initialBalanceDate: '2020-01-01' })];
    state.hist = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']
      .map((month, k) => ({ month, balance: 100 * k }));
    render(<SavingsPage />);
    expect(screen.getByText('12 derniers mois')).toBeInTheDocument();
  });
});

describe('<SavingsPage /> — dernier mouvement (L120)', () => {
  it("R6 — la carte écrit la nature, la date et le montant signé du dernier mouvement, sans « dernier mouvement » ni flèche", () => {
    state.hist = [];
    state.items = [account({ movements: [
      { id: 'i', date: '2026-01-01', amount: 6800, source: 'initial', statementId: null, transactionId: null },
      { id: 'b', date: '2026-09-30', amount: -200, source: 'bank-extract', statementId: 's', transactionId: null },
    ] })];
    render(<SavingsPage />);
    expect(screen.getByText(/Ajustement au relevé · 30\/09 : −200,00/)).toBeInTheDocument();
    expect(screen.queryByText(/dernier mouvement/)).not.toBeInTheDocument();
  });
});
