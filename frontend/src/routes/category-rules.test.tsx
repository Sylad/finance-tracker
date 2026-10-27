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
  it('R12 — une suppression de catégorie refusée affiche une alerte nommant la catégorie', async () => {
    api.delete.mockRejectedValueOnce(new Error('verrouillée'));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer la catégorie Animaux' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Suppression de la catégorie Animaux impossible : verrouillée.');
  });

  it('R13 — « Fermer le message » retire l’alerte d’échec', async () => {
    api.delete.mockRejectedValueOnce(new Error('refusé'));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer la catégorie Animaux' }));
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Fermer le message' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('R14 — l’alerte d’échec est amenée à l’écran (la page a pu défiler jusqu’à la corbeille)', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    api.delete.mockRejectedValue(new Error('refusé'));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer la catégorie Animaux' }));
    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    expect(scroll.mock.contexts[0]).toBe(alert);
    // Même message, deuxième échec : l’alerte est de nouveau amenée à l’écran.
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer la catégorie Animaux' }));
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(2));
  });

  it('R15 — après suppression d’une règle, le focus passe à « Règles actives » au lieu de tomber sur <body>', async () => {
    renderPage();
    const trash = await screen.findByRole('button', { name: 'Supprimer la règle /LIDL/i' });
    trash.focus();
    api.get.mockResolvedValue({ ...payload, rules: [payload.rules[0]] });
    await userEvent.keyboard('{Enter}');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Supprimer la règle' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/category-rules/r2'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Supprimer la règle /LIDL/i' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('Règles actives')));
  });

  it('R16 — après suppression d’une catégorie, le focus passe au champ de nom au lieu de tomber sur <body>', async () => {
    renderPage();
    const trash = await screen.findByRole('button', { name: 'Supprimer la catégorie Animaux' });
    api.get.mockResolvedValue({ ...payload, userCategories: [] });
    trash.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/category-rules/user-categories/c1'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Nom de la nouvelle catégorie')));
  });

  it('R17 — une suggestion garde son motif lisible à 390 px : la colonne du motif prend la ligne, les boutons passent dessous', async () => {
    sugg.list = [{ id: 'g1', pattern: 'SPOTIFY', category: 'subscriptions', subcategory: '', occurrenceCount: 3, exampleDescriptions: [], status: 'pending', rationale: '' }];
    renderPage();
    const accept = await screen.findByRole('button', { name: 'Accepter /SPOTIFY/i' });
    const texte = screen.getByText('/SPOTIFY/i').closest('div')!.parentElement!;
    expect(texte.className).toContain('basis-full');
    expect(texte.className).toContain('sm:basis-0');
    expect(accept.parentElement!.parentElement!.className).toContain('flex-wrap');
  });

  it('R18 — un motif de suggestion long sans espace se coupe dans la largeur (break-all) au lieu de faire défiler la page à 390 px', async () => {
    const pattern = 'SPOTIFY|DEEZER|APPLE\\.COM/BILL|AMAZON\\s+PRIME\\s+VIDEO';
    sugg.list = [{ id: 'g1', pattern, category: 'subscriptions', subcategory: '', occurrenceCount: 3, exampleDescriptions: [], status: 'pending', rationale: '' }];
    renderPage();
    const code = await screen.findByText(`/${pattern}/i`);
    expect(code.tagName).toBe('CODE');
    expect(code.className).toContain('break-all');
  });

  it('R19 — l’alerte d’échec amenée à l’écran n’est pas recouverte par l’en-tête fixe du téléphone (scroll-mt-20 sous lg)', async () => {
    api.delete.mockRejectedValue(new Error('refusé'));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer la catégorie Animaux' }));
    const alert = await screen.findByRole('alert');
    expect(alert.className).toContain('scroll-mt-20');
    expect(alert.className).toContain('lg:scroll-mt-6');
  });
  it('R21 — dans « Voir les masqués », un motif long se coupe dans la largeur (break-all, pas de truncate) et la colonne du motif prend la ligne sous 640 px', async () => {
    const pattern = 'SPOTIFY|DEEZER|APPLE\\.COM/BILL|AMAZON\\s+PRIME\\s+VIDEO|NETFLIX\\.COM|DISNEY\\s*PLUS';
    sugg.list = [{ id: 'g3', pattern, category: 'subscriptions', subcategory: '', occurrenceCount: 3, exampleDescriptions: [], status: 'snoozed', rationale: '' }];
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Voir les masqués/ }));
    const code = screen.getByText(`/${pattern}/i`, { exact: false });
    expect(code.tagName).toBe('CODE');
    expect(code.className).toContain('break-all');
    expect(code.className).not.toContain('truncate');
    const colonne = code.parentElement!;
    expect(colonne.className).toContain('basis-full');
    expect(colonne.className).toContain('sm:basis-0');
    expect(colonne.parentElement!.className).toContain('flex-wrap');
  });
});
