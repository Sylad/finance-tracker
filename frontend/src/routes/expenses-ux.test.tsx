import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExpensesPage } from './expenses';
import { api } from '@/lib/api';

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const demo = vi.hoisted(() => ({ forced: false }));
vi.mock('@/lib/queries', () => ({ useDemoStatus: () => ({ data: { forced: demo.forced } }) }));

vi.mock('@/lib/api', () => ({
  ApiError: class extends Error { status = 0; },
  api: { get: vi.fn(), post: vi.fn() },
}));

const LONG = 'PRELEVEMENT TRES LONG LIBELLE QUI DEPASSE LA LARGEUR DE LA CELLULE SUR TELEPHONE';
const breakdown = (totalDebits: number) => ({
  monthId: '2026-09', totalDebits,
  buckets: {
    credits: { total: 0, transactions: [] }, subscriptions: { total: 0, transactions: [] },
    savings: { total: 0, transactions: [] }, neutral: { total: 0, transactions: [] },
  },
  categories: [{ category: 'food', total: totalDebits, count: 1, transactions: [{ id: 't1', date: '2026-09-03', description: LONG, amount: -totalDebits }] }],
});

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ExpensesPage />
    </QueryClientProvider>,
  );
}

function mockGet(opts: { breakdown?: () => Promise<unknown>; statements?: unknown[] } = {}) {
  get.mockImplementation(((url: string) => {
    if (url === '/statements') return Promise.resolve(opts.statements ?? [{ id: '2026-09' }, { id: '2026-08' }]);
    return opts.breakdown ? opts.breakdown() : Promise.resolve(breakdown(100));
  }) as never);
}

beforeEach(() => { demo.forced = false; get.mockReset(); post.mockReset(); vi.restoreAllMocks(); });

describe('ExpensesPage — revue UX (L38)', () => {
  it('R1 — un chargement en échec dit l’erreur et propose Réessayer, jamais « Aucun relevé »', async () => {
    let fail = true;
    mockGet({ breakdown: () => (fail ? Promise.reject(new Error('boom')) : Promise.resolve(breakdown(100))) });
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Impossible de charger les dépenses/);
    expect(screen.queryByText('Aucun relevé')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Mois du relevé' })).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: /Réessayer/ }));
    await waitFor(() => expect(screen.getByText(/Répartition des retraits/)).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('R2 — une analyse en échec s’affiche dans la page (role=alert), sans fenêtre alert()', async () => {
    mockGet();
    const win = vi.spyOn(window, 'alert').mockImplementation(() => {});
    post.mockRejectedValue(new Error('panne réseau'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Proposer des coupes/ }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Analyse impossible/);
    expect(alert.textContent).toMatch(/panne réseau/);
    expect(win).not.toHaveBeenCalled();
  });

  it('R3 — un mois sans retrait n’affiche pas « NaN % » ni « Infinity % »', async () => {
    mockGet({ breakdown: () => Promise.resolve(breakdown(0)) });
    renderPage();
    const legend = await screen.findByRole('button', { name: /Alimentation|food/i });
    expect(legend.textContent).not.toMatch(/NaN|Infinity/);
    expect(legend.textContent).toMatch(/0,0 %/);
  });

  it('R4 — les lignes de légende annoncent leur état (aria-pressed) et le basculent au clic', async () => {
    mockGet();
    renderPage();
    const legend = await screen.findByRole('button', { name: /Alimentation|food/i });
    expect(legend.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(legend);
    expect(legend.getAttribute('aria-pressed')).toBe('true');
  });

  it('R5 — le mois se lit en toutes lettres (menu et sous-titre), pas en identifiant brut', async () => {
    mockGet();
    renderPage();
    const select = (await screen.findByRole('combobox', { name: 'Mois du relevé' })) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(2));
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Septembre 2026', 'Août 2026']);
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['2026-09', '2026-08']);
    expect(await screen.findByText(/Relevé de septembre 2026/)).toBeTruthy();
  });

  it('R6 — pendant l’analyse, la durée est dite dans la page (role=status), sans jargon matériel', async () => {
    mockGet();
    post.mockReturnValue(new Promise(() => {}));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Proposer des coupes/ }));
    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch(/1 à 3 minutes/);
    expect(document.body.textContent).not.toMatch(/5090/);
  });

  it('R7 — le libellé d’un retrait tronqué reste lisible en entier (title)', async () => {
    mockGet();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Alimentation|food/i }));
    expect(await screen.findByTitle(LONG)).toBeTruthy();
  });

  it('R8 — à 390 px le détail ne fait pas déborder la page : cartes min-w-0, libellé borné plus court sur téléphone', async () => {
    mockGet();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Alimentation|food/i }));
    const cell = await screen.findByTitle(LONG);
    expect(cell.className).toMatch(/max-w-\[140px\]/);
    expect(cell.className).toMatch(/sm:max-w-\[220px\]/);
    for (const card of [cell.closest('.card'), screen.getByText('Répartition des retraits').closest('.card')]) {
      expect(card?.className).toMatch(/\bmin-w-0\b/);
    }
  });

  it('R9 — en démo forcée, la page dit que l’analyse IA locale n’est pas disponible et ne lance pas l’appel', async () => {
    demo.forced = true;
    mockGet();
    renderPage();
    const button = await screen.findByRole('button', { name: /Proposer des coupes/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const note = screen.getByText(/analyse par IA locale n’est pas disponible en démo/i);
    expect(button.getAttribute('aria-describedby')).toBe(note.id);
    fireEvent.click(button);
    expect(post).not.toHaveBeenCalled();
  });

  it('R9 — hors démo forcée, aucune note et le bouton est actif', async () => {
    mockGet();
    renderPage();
    const button = await screen.findByRole('button', { name: /Proposer des coupes/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(screen.queryByText(/n’est pas disponible en démo/)).toBeNull();
  });
});
