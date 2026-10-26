import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LoanSuggestion, Subscription } from '@/types/api';
import { SubscriptionsPage } from './subscriptions';
import { DedupeSubscriptionsModal } from '@/components/subscriptions/dedupe-subscriptions-modal';

const q = (over: Record<string, unknown> = {}) => ({
  isLoading: false, isError: false, isFetching: false, data: undefined as unknown, refetch: vi.fn(), ...over,
});

const h = vi.hoisted(() => ({
  subs: {} as ReturnType<typeof q>,
  sugg: {} as ReturnType<typeof q>,
  dupes: {} as ReturnType<typeof q>,
  // Une mutation qui échoue : `mutate` rappelle onError, `mutateAsync` rejette.
  fail: false,
  remove: vi.fn(),
  snooze: vi.fn(),
  reject: vi.fn(),
  reset: vi.fn(),
  merge: vi.fn(),
}));

const failing = (fn: ReturnType<typeof vi.fn>) => (arg: unknown, opts?: { onError?: (e: Error) => void }) => {
  fn(arg);
  if (h.fail) opts?.onError?.(new Error('Serveur indisponible'));
};

vi.mock('@/lib/queries', () => ({
  useSubscriptions: () => h.subs,
  useLoanSuggestions: () => h.sugg,
  useCreateSubscription: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateSubscription: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteSubscription: () => ({ mutate: failing(h.remove), isPending: false }),
  useResetSubscriptions: () => ({
    mutateAsync: async () => {
      h.reset();
      if (h.fail) throw new Error('Serveur indisponible');
      return { deletedSubscriptions: 3, resetSuggestions: 2 };
    },
    isPending: false,
  }),
  useSnoozeSuggestion: () => ({ mutate: failing(h.snooze), isPending: false }),
  useRejectSuggestion: () => ({ mutate: failing(h.reject), isPending: false }),
  useUnsnoozeSuggestion: () => ({ mutate: vi.fn(), isPending: false }),
  useAcceptSubscriptionSuggestion: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSubscriptionDuplicates: () => h.dupes,
  useMergeSubscriptionDuplicates: () => ({
    mutateAsync: async (arg: unknown) => {
      h.merge(arg);
      if (h.fail) throw new Error('Serveur indisponible');
    },
    isPending: false,
  }),
}));

const netflix = {
  id: 's1', name: 'Netflix', creditor: 'NETFLIX', monthlyAmount: 13.49, frequency: 'monthly',
  category: 'streaming', matchPattern: 'NETFLIX', isActive: true, occurrencesDetected: [],
} as unknown as Subscription;

const suggestion = {
  id: 'g1', label: 'Spotify AB', creditor: 'Spotify', monthlyAmount: 10.99, occurrencesSeen: 4,
  suggestedType: 'subscription', status: 'pending', matchPattern: 'SPOTIFY', firstSeenDate: '2026-01-05',
} as unknown as LoanSuggestion;

const group = {
  normalizedName: 'netflix', monthlyAmount: 13.49, reasons: ['nom identique'],
  subscriptions: [
    { ...netflix, id: 'a', createdAt: '2026-01-01', occurrencesCount: 3 },
    { ...netflix, id: 'b', createdAt: '2026-02-01', occurrencesCount: 1 },
  ],
};

let nativeConfirm: ReturnType<typeof vi.fn>;
let nativeAlert: ReturnType<typeof vi.fn>;

beforeEach(() => {
  h.subs = q({ data: [netflix] });
  h.sugg = q({ data: [suggestion] });
  h.dupes = q({ data: [group] });
  h.fail = false;
  for (const f of [h.remove, h.snooze, h.reject, h.reset, h.merge]) f.mockClear();
  nativeConfirm = vi.fn(() => true);
  nativeAlert = vi.fn();
  vi.stubGlobal('confirm', nativeConfirm);
  vi.stubGlobal('alert', nativeAlert);
});
afterEach(() => vi.unstubAllGlobals());

describe('Abonnements — restes de la revue L33 (L151)', () => {
  it('R1 — la modale Doublons est un dialogue modal nommé par son titre, le focus y entre, Échap ferme', async () => {
    const onClose = vi.fn();
    render(<DedupeSubscriptionsModal onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: "Doublons d'abonnements" });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('R2 — Supprimer ouvre une confirmation dans la page (pas de confirm natif) ; Annuler ne supprime rien', async () => {
    render(<SubscriptionsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer Netflix' }));
    const dialog = screen.getByRole('dialog', { name: 'Supprimer Netflix ?' });
    expect(nativeConfirm).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(h.remove).not.toHaveBeenCalled();
  });

  it('R3 — confirmer la suppression supprime l\'abonnement et ferme la confirmation', async () => {
    render(<SubscriptionsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer Netflix' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Supprimer' }));
    expect(h.remove).toHaveBeenCalledWith('s1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('R4 — Reset demande confirmation dans la page, puis annonce le résultat en texte (ni confirm ni alert natifs)', async () => {
    render(<SubscriptionsPage />);
    await userEvent.click(screen.getByRole('button', { name: /Reset/ }));
    const dialog = screen.getByRole('dialog', { name: 'Réinitialiser les abonnements ?' });
    expect(h.reset).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Réinitialiser' }));
    expect(await screen.findByRole('status')).toHaveTextContent('3 abonnement(s) supprimé(s), 2 suggestion(s) remise(s) à trier.');
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(nativeAlert).not.toHaveBeenCalled();
  });

  it('R5 — un Reset en échec affiche le message dans la page (role=alert), sans alert natif', async () => {
    h.fail = true;
    render(<SubscriptionsPage />);
    await userEvent.click(screen.getByRole('button', { name: /Reset/ }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Réinitialiser' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Réinitialisation impossible : Serveur indisponible');
    expect(nativeAlert).not.toHaveBeenCalled();
  });

  it('R6 — le champ du motif s\'appelle « Motif cherché dans les libellés (expression régulière) », plus « Pattern (regex) »', async () => {
    render(<SubscriptionsPage />);
    await userEvent.click(screen.getByRole('button', { name: /Nouvel abonnement/ }));
    expect(screen.getByLabelText(/Motif cherché dans les libellés/)).toBeTruthy();
    expect(screen.queryByText(/Pattern/)).toBeNull();
  });

  it('R7 — une suppression refusée est dite, en nommant l\'abonnement', async () => {
    h.fail = true;
    render(<SubscriptionsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer Netflix' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Supprimer' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Suppression de Netflix impossible : Serveur indisponible');
  });

  it('R8 — un masquage refusé et un rejet refusé sont dits, en nommant la suggestion', async () => {
    h.fail = true;
    render(<SubscriptionsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Connu, masquer Spotify AB' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Masquage de Spotify AB impossible : Serveur indisponible');
    await userEvent.click(screen.getByRole('button', { name: 'Faux positif Spotify AB' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Rejet de Spotify AB impossible : Serveur indisponible');
  });

  it('R9 — le message d\'échec se ferme (bouton « Fermer le message »)', async () => {
    h.fail = true;
    render(<SubscriptionsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Connu, masquer Spotify AB' }));
    await userEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Fermer le message' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('R10 — suggestions en échec et aucun abonnement : pas de « importe un relevé » qui contredit le bandeau', () => {
    h.subs = q({ data: [] });
    h.sugg = q({ isError: true });
    render(<SubscriptionsPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('Suggestions indisponibles');
    expect(screen.getByText('Aucun abonnement déclaré')).toBeTruthy();
    expect(screen.queryByText(/importe un relevé/i)).toBeNull();
    expect(screen.getByText(/ajoute un abonnement manuellement/i)).toBeTruthy();
  });

  it('R11 — sans échec et sans abonnement, le conseil « importe un relevé » reste affiché', () => {
    h.subs = q({ data: [] });
    h.sugg = q({ data: [] });
    render(<SubscriptionsPage />);
    expect(screen.getByText(/importe un relevé/i)).toBeTruthy();
  });

  it('R12 — une fusion refusée est dite dans la modale Doublons (role=alert), sans alert natif', async () => {
    h.fail = true;
    render(<DedupeSubscriptionsModal onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /Fusionner/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Fusion impossible : Serveur indisponible');
    expect(nativeAlert).not.toHaveBeenCalled();
  });
});
