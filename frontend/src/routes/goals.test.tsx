import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GoalsPage } from './goals';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));

const goal = (over: Record<string, unknown> = {}) => ({
  id: 'g1', name: 'Apport', type: 'savings_total', targetAmount: 10000, targetDate: null,
  startAmount: 0, startDate: '2026-01-01', currentAmount: 2500, progressPct: 25, remaining: 7500,
  monthlyPaceNeeded: null, projection: 'no-deadline', monthsElapsed: 3, monthsRemaining: null, ...over,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><GoalsPage /></QueryClientProvider>);
}

describe('Objectifs — revue UX (L35)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue([goal(), goal({ id: 'g2', name: 'Voyage', progressPct: 140 })]);
    api.post.mockResolvedValue({});
    api.delete.mockResolvedValue({});
  });

  it('R1 — chargement en échec : message et Réessayer, jamais « Aucun objectif »', async () => {
    api.get.mockRejectedValueOnce(new Error('boom'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de charger les objectifs.');
    expect(screen.queryByText(/Aucun objectif/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Réessayer/ }));
    expect(await screen.findByText('2 objectifs actifs.')).toBeTruthy();
  });

  it('R2 — la corbeille porte le nom de l’objectif', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: 'Supprimer l’objectif Apport' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Supprimer l’objectif Voyage' })).toBeTruthy();
  });

  it('R3 — supprimer demande confirmation dans la page, rien n’est supprimé avant', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer l’objectif Voyage' }));
    const dlg = screen.getByRole('dialog');
    expect(api.delete).not.toHaveBeenCalled();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Annuler' }));
    expect(api.delete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer l’objectif Voyage' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Supprimer l’objectif' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/goals/g2'));
  });

  it('R4 — une suppression refusée affiche une alerte nommant l’objectif', async () => {
    api.delete.mockRejectedValueOnce(new Error('refusé'));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer l’objectif Apport' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Supprimer l’objectif' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Suppression de l’objectif Apport impossible');
    expect(alert).toHaveTextContent('refusé');
  });

  it('R5 — une création refusée affiche une alerte et garde le formulaire rempli', async () => {
    api.post.mockRejectedValueOnce(new Error('invalide'));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Nouvel objectif/ }));
    await userEvent.type(screen.getByLabelText('Nom'), 'Voiture');
    await userEvent.type(screen.getByLabelText('Montant cible (€)'), '8000');
    await userEvent.click(screen.getByRole('button', { name: 'Créer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Création de l’objectif Voiture impossible');
    expect((screen.getByLabelText('Nom') as HTMLInputElement).value).toBe('Voiture');
  });

  it('R6 — chaque champ du formulaire est relié à son libellé', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Nouvel objectif/ }));
    for (const l of ['Nom', 'Type', 'Montant cible (€)', 'Date cible (optionnel)']) {
      expect(screen.getByLabelText(l)).toBeTruthy();
    }
  });

  it('R7 — la barre de progression est annoncée (progressbar) et bornée à 0–100 %', async () => {
    renderPage();
    const bars = await screen.findAllByRole('progressbar');
    expect(bars[0]).toHaveAttribute('aria-valuenow', '25');
    expect(bars[0]).toHaveAccessibleName('Progression de l’objectif Apport');
    expect(bars[1]).toHaveAttribute('aria-valuenow', '100');
    expect((bars[1].firstElementChild as HTMLElement).style.width).toBe('100%');
  });

  it('R8 — un montant cible négatif ou nul ne permet pas de créer', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Nouvel objectif/ }));
    await userEvent.type(screen.getByLabelText('Nom'), 'X');
    await userEvent.type(screen.getByLabelText('Montant cible (€)'), '-5');
    expect(screen.getByRole('button', { name: 'Créer' })).toBeDisabled();
  });
});
