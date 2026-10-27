import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CategoryRulesPage } from './category-rules';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));

const idle = { mutate: vi.fn(), isPending: false, isSuccess: false, isError: false, error: null as unknown, data: undefined as unknown };
const sugg = vi.hoisted(() => ({ list: [] as unknown[], generate: {} as Record<string, unknown>, accept: vi.fn(), failed: {} as Record<string, unknown> }));
vi.mock('@/lib/queries', () => ({
  useCategoryRuleSuggestions: () => ({ data: sugg.list }),
  useGenerateCategorySuggestions: () => sugg.generate,
  useAcceptCategorySuggestion: () => ({ mutate: sugg.accept, isPending: false, ...sugg.failed.accept as object }),
  useRejectCategorySuggestion: () => ({ mutate: vi.fn(), isPending: false, ...sugg.failed.reject as object }),
  useSnoozeCategorySuggestion: () => ({ mutate: vi.fn(), isPending: false, ...sugg.failed.snooze as object }),
}));

const payload = {
  rules: [
    { id: 'r1', pattern: 'NETFLIX', flags: 'i', category: 'subscriptions', subcategory: '', priority: 5, createdAt: '2026-01-01' },
    { id: 'r2', pattern: 'LIDL', flags: 'i', category: 'food', subcategory: '', priority: 9, createdAt: '2026-01-01' },
  ],
  userCategories: [{ id: 'c1', name: 'Animaux' }],
  availableCategories: [],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><CategoryRulesPage /></QueryClientProvider>);
}

describe('Règles de catégories — revue UX (L34)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue(payload);
    api.post.mockResolvedValue({});
    api.delete.mockResolvedValue({});
    sugg.list = [];
    sugg.failed = {};
    sugg.generate = { ...idle, mutate: vi.fn() };
  });

  it('R1 — chargement en échec : message et Réessayer, jamais « 0 règle active »', async () => {
    api.get.mockRejectedValueOnce(new Error('boom'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de charger les règles de catégorisation.');
    expect(screen.queryByText(/0 règle/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Réessayer/ }));
    expect(await screen.findByText(/2 règles actives/)).toBeTruthy();
  });

  it('R2 — les boutons corbeille portent le nom de la règle ou de la catégorie', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: 'Supprimer la règle /NETFLIX/i' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Supprimer la catégorie Animaux' })).toBeTruthy();
  });

  it('R3 — supprimer une règle demande confirmation dans la page, et rien n’est supprimé avant', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer la règle /LIDL/i' }));
    const dlg = screen.getByRole('dialog');
    expect(api.delete).not.toHaveBeenCalled();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Annuler' }));
    expect(api.delete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer la règle /LIDL/i' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Supprimer la règle' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/category-rules/r2'));
  });

  it('R4 — une suppression refusée affiche une alerte nommant la règle', async () => {
    api.delete.mockRejectedValueOnce(new Error('refusé'));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer la règle /LIDL/i' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Supprimer la règle' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Suppression de /LIDL/i impossible');
  });

  it('R5 — un ajout de catégorie refusé affiche une alerte et garde le nom saisi', async () => {
    api.post.mockRejectedValueOnce(new Error('doublon'));
    renderPage();
    const input = await screen.findByLabelText('Nom de la nouvelle catégorie');
    await userEvent.type(input, 'Voyages');
    await userEvent.click(screen.getByRole('button', { name: /Ajouter/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ajout de la catégorie Voyages impossible');
    expect((input as HTMLInputElement).value).toBe('Voyages');
  });

  it('R6 — le résultat du rejeu est annoncé (role=status) et son échec dit (role=alert)', async () => {
    api.post.mockResolvedValueOnce({ processed: 3, updated: 1 });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Rejouer sur tout l'historique/ }));
    expect(await screen.findByRole('status')).toHaveTextContent('1 relevé(s) modifié(s) sur 3');
    api.post.mockRejectedValueOnce(new Error('x'));
    await userEvent.click(screen.getByRole('button', { name: /Rejouer sur tout l'historique/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Rejeu impossible');
  });

  it('R7 — les règles s’affichent par priorité décroissante sans muter le cache', async () => {
    renderPage();
    await screen.findByText(/2 règles actives/);
    const codes = screen.getAllByText(/^\/(LIDL|NETFLIX)\/i$/).map((e) => e.textContent);
    expect(codes).toEqual(['/LIDL/i', '/NETFLIX/i']);
    expect(payload.rules.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('R8 — chaque ligne se replie en pile sous 640 px (pas de grille à 12 colonnes figée)', async () => {
    const { container } = renderPage();
    await screen.findByText(/2 règles actives/);
    expect(container.querySelector('.grid-cols-12')).toBeNull();
  });

  it('R9 — les actions d’une suggestion citent son motif', async () => {
    sugg.list = [{ id: 'g1', pattern: 'SPOTIFY', category: 'subscriptions', subcategory: '', occurrenceCount: 3, exampleDescriptions: [], status: 'pending', rationale: '' }];
    renderPage();
    expect(await screen.findByRole('button', { name: 'Accepter /SPOTIFY/i' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Plus tard /SPOTIFY/i' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rejeter /SPOTIFY/i' })).toBeTruthy();
  });

  it('R10 — une analyse en échec est dite (role=alert), pas silencieuse', async () => {
    sugg.generate = { ...idle, isError: true, error: new Error('Claude indisponible') };
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Analyse impossible');
  });
  it.each([
    ['accept', 'accepter'],
    ['reject', 'rejeter'],
    ['snooze', 'reporter'],
  ])('R11 — %s d’une suggestion en échec est dit (role=alert), pas silencieux', async (key, verbe) => {
    sugg.list = [{ id: 'g1', pattern: 'SPOTIFY', category: 'subscriptions', subcategory: '', occurrenceCount: 3, exampleDescriptions: [], status: 'pending', rationale: '' }];
    sugg.failed = { [key]: { isError: true, error: new Error('API 500') } };
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(`Impossible de ${verbe} la suggestion`);
    expect(alert).toHaveTextContent('API 500');
  });
});
