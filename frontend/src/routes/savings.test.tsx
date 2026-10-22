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

const state = vi.hoisted(() => ({ items: [] as unknown[] }));
const idle = { mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false };

vi.mock('@/lib/queries', () => ({
  useSavingsAccounts: () => ({ data: state.items, isLoading: false }),
  useCreateSavingsAccount: () => idle,
  useUpdateSavingsAccount: () => idle,
  useDeleteSavingsAccount: () => idle,
  useSavingsHistory: () => ({ data: [] }),
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
