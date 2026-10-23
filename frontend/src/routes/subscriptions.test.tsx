import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LoanSuggestion, Subscription } from '@/types/api';
import { SubscriptionsPage } from './subscriptions';

const q = (over: Record<string, unknown> = {}) => ({
  isLoading: false, isError: false, isFetching: false, data: undefined as unknown, refetch: vi.fn(), ...over,
});

const state = vi.hoisted(() => ({ subs: {} as ReturnType<typeof q>, sugg: {} as ReturnType<typeof q> }));
const idle = { mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false };

vi.mock('@/lib/queries', () => ({
  useSubscriptions: () => state.subs,
  useLoanSuggestions: () => state.sugg,
  useCreateSubscription: () => idle,
  useUpdateSubscription: () => idle,
  useDeleteSubscription: () => idle,
  useResetSubscriptions: () => idle,
  useSnoozeSuggestion: () => idle,
  useRejectSuggestion: () => idle,
  useUnsnoozeSuggestion: () => idle,
  useAcceptSubscriptionSuggestion: () => idle,
}));

const netflix = {
  id: 's1', name: 'Netflix', creditor: 'NETFLIX', monthlyAmount: 13.49, frequency: 'monthly',
  category: 'streaming', matchPattern: 'NETFLIX', isActive: true, occurrencesDetected: [],
} as unknown as Subscription;

const suggestion = {
  id: 'g1', label: 'Spotify AB', creditor: 'Spotify', monthlyAmount: 10.99, occurrencesSeen: 4,
  suggestedType: 'subscription', status: 'pending', matchPattern: 'SPOTIFY', firstSeenDate: '2026-01-05',
} as unknown as LoanSuggestion;

describe('Abonnements — revue UX (L33)', () => {
  beforeEach(() => {
    state.subs = q({ data: [netflix] });
    state.sugg = q({ data: [suggestion] });
  });

  it('R1 — liste en échec : ErrorState avec Réessayer, jamais « Aucun abonnement déclaré » ni « 0,00 € »', async () => {
    state.subs = q({ isError: true });
    render(<SubscriptionsPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('Impossible de charger les abonnements.');
    expect(screen.queryByText('Aucun abonnement déclaré')).toBeNull();
    expect(screen.queryByText(/0,00/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Nouvel abonnement/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Réessayer/ }));
    expect(state.subs.refetch).toHaveBeenCalledTimes(1);
  });

  it('R2 — un échec de rafraîchissement garde les abonnements déjà chargés', () => {
    state.subs = q({ isError: true, data: [netflix] });
    render(<SubscriptionsPage />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Netflix')).toBeTruthy();
  });

  it('R3 — suggestions en échec : alerte « suggestions indisponibles » avec Réessayer, abonnements affichés', async () => {
    state.sugg = q({ isError: true });
    render(<SubscriptionsPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('Suggestions indisponibles');
    expect(screen.getByText('Netflix')).toBeTruthy();
    await userEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: /Réessayer/ }));
    expect(state.sugg.refetch).toHaveBeenCalledTimes(1);
  });

  it('R4 — les boutons icône Modifier / Supprimer sont nommés par abonnement', () => {
    render(<SubscriptionsPage />);
    expect(screen.getByRole('button', { name: 'Modifier Netflix' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Supprimer Netflix' })).toBeTruthy();
  });

  it('R5 — les trois actions d’une suggestion commencent par leur libellé visible et citent la suggestion', () => {
    render(<SubscriptionsPage />);
    expect(screen.getByRole('button', { name: 'Enregistrer Spotify AB' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connu, masquer Spotify AB' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Faux positif Spotify AB' })).toBeTruthy();
  });

  it('R6 — le formulaire est une modale nommée par son titre, Échap la ferme, le focus revient au bouton', async () => {
    render(<SubscriptionsPage />);
    const edit = screen.getByRole('button', { name: 'Modifier Netflix' });
    await userEvent.click(edit);
    const dialog = screen.getByRole('dialog', { name: "Modifier l'abonnement" });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(within(dialog).getByRole('button', { name: 'Fermer' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(edit);
  });

  it('R7 — le formulaire tient à 320 px : les paires de champs passent sur une colonne sous 640 px', async () => {
    render(<SubscriptionsPage />);
    await userEvent.click(screen.getByRole('button', { name: /Nouvel abonnement/ }));
    const dialog = screen.getByRole('dialog', { name: 'Nouvel abonnement' });
    const grids = dialog.querySelectorAll('form .grid');
    expect(grids.length).toBe(3);
    grids.forEach((g) => expect(g.className).toMatch(/\bgrid-cols-1\b.*\bsm:grid-cols-2\b/));
  });
});
