import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SavingsAccount } from '@/types/api';
import { SavingsPage } from './savings';

const q = (over: Record<string, unknown> = {}) => ({
  isLoading: false, isError: false, isFetching: false, data: undefined as unknown, refetch: vi.fn(), ...over,
});

const state = vi.hoisted(() => ({ list: {} as ReturnType<typeof q> }));
const idle = { mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false };

vi.mock('@/lib/queries', () => ({
  useSavingsAccounts: () => state.list,
  useCreateSavingsAccount: () => idle,
  useUpdateSavingsAccount: () => idle,
  useDeleteSavingsAccount: () => idle,
  useSavingsHistory: () => ({ data: [] }),
  useResyncSavings: () => idle,
}));

const account = {
  id: 'a', name: 'Livret A', type: 'livret-a', initialBalance: 100, initialBalanceDate: '2026-01-01',
  matchPattern: '', accountNumber: '', interestRate: 0.015, interestAnniversaryMonth: 12,
  currentBalance: 1234, movements: [],
} as unknown as SavingsAccount;

describe('Épargne — erreurs de chargement (L118)', () => {
  beforeEach(() => {
    state.list = q({ data: [account] });
  });

  it('R1 — liste en échec : ErrorState avec Réessayer, jamais « Aucun compte épargne déclaré »', async () => {
    state.list = q({ isError: true });
    render(<SavingsPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('Impossible de charger les comptes épargne.');
    expect(screen.queryByText('Aucun compte épargne déclaré')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Réessayer/ }));
    expect(state.list.refetch).toHaveBeenCalledTimes(1);
  });

  it('R2 — liste en échec : aucun total « 0,00 € » ni « 0 compte » affiché', () => {
    state.list = q({ isError: true });
    render(<SavingsPage />);
    expect(screen.queryByText(/0,00/)).toBeNull();
    expect(screen.queryByText(/0 compte/)).toBeNull();
  });

  it('R3 — liste en échec : pas de bouton « Ajouter un compte » (la liste existante est inconnue)', () => {
    state.list = q({ isError: true });
    render(<SavingsPage />);
    expect(screen.queryByRole('button', { name: 'Ajouter un compte' })).toBeNull();
  });

  it('R4 — un échec de rafraîchissement garde les comptes déjà chargés', () => {
    state.list = q({ isError: true, data: [account] });
    render(<SavingsPage />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Livret A')).toBeTruthy();
  });

  it('R5 — Réessayer est désactivé pendant le rechargement', () => {
    state.list = q({ isError: true, isFetching: true });
    render(<SavingsPage />);
    expect(screen.getByRole('button', { name: /Réessayer/ })).toBeDisabled();
  });
});
