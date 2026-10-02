import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlanPage } from './plan';

// Les liens passent par le routeur ; un <a> suffit ici.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, hash, children, ...rest }: { to: string; hash?: string; children: React.ReactNode }) => (
    <a href={hash ? `${to}#${hash}` : to} {...rest}>{children}</a>
  ),
}));

const plan = {
  version: 1,
  project: 'finance-tracker',
  lots: [
    { id: 'L18', title: 'Une page Nouveautés', status: 'done', started: '2026-09-28', finished: '2026-09-28' },
    { id: 'L21', title: 'Un tableau de bord plus lisible', status: 'done', started: '2026-09-28', finished: '2026-09-28',
      tasks: [{ title: 'Textes plus contrastés', status: 'done' }, { title: 'Graphiques légendés', status: 'done' }] },
    { id: 'L3', title: 'Très ancien', status: 'done', finished: '2026-06-01' },
    { id: 'L47', title: 'Une pastille pour ce qui est nouveau', status: 'todo' },
    { id: 'L48', title: 'Une page Plan de travail', status: 'doing', started: '2026-10-01',
      tasks: [{ status: 'done' }, { status: 'todo' }] },
  ],
};
const news = { project: 'finance-tracker', generated: 'x', entries: [{ slug: '2026-09-28-tableau', title: 'T', date: '2026-09-28', lots: ['L21'], captures: [], html: '' }] };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PlanPage />
    </QueryClientProvider>,
  );
}

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const serve = (planRes: unknown, newsRes: unknown = okJson(news)) =>
  vi.fn((url: string) => Promise.resolve(url.startsWith('/plan-data') ? planRes : newsRes));

describe('<PlanPage />', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T10:00:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.location.hash = '';
  });

  it('montre En cours, Prévu puis Récemment livré, avec le résumé en évolutions', async () => {
    const fetchMock = serve(okJson(plan));
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    const headings = await screen.findAllByRole('heading', { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual([
      expect.stringContaining('En cours'),
      expect.stringContaining('Prévu'),
      expect.stringContaining('Récemment livré'),
    ]);
    expect(fetchMock).toHaveBeenCalledWith('/plan-data/plan.json', expect.anything());
    expect(screen.getByText('1 évolution en cours, 1 prévue, 2 livrées ces 30 derniers jours.')).toBeInTheDocument();

    const done = screen.getByRole('region', { name: /Récemment livré/ });
    expect(within(done).queryByText('Très ancien')).not.toBeInTheDocument();
    expect(within(done).getByText(/1 évolution livrée plus ancienne/)).toBeInTheDocument();
    expect(within(done).getByRole('link', { name: /voir les Nouveautés/ })).toHaveAttribute('href', '/nouveautes');
  });

  it('carte : surtitle badge · date, id ancre, titre, barre n/m étapes nommée, actions', async () => {
    vi.stubGlobal('fetch', serve(okJson(plan)));
    renderPage();

    const card = (await screen.findByRole('heading', { level: 3, name: 'Une page Plan de travail' })).closest('li')!;
    expect(card).toHaveAttribute('id', 'L48');
    expect(within(card).getByText('En cours')).toBeInTheDocument();
    expect(within(card).getByText('Démarré le 1er octobre 2026')).toBeInTheDocument();
    expect(within(card).getByText('L48')).toBeInTheDocument();
    const bar = within(card).getByRole('progressbar', { name: 'Avancement : Une page Plan de travail' });
    expect(bar).toHaveAttribute('aria-valuetext', '1 étape faite sur 2');
    expect(within(card).getByText('1/2 étapes')).toBeInTheDocument();
    // Étapes sans titre public : compteur seulement, pas de dépliage.
    expect(within(card).queryByRole('button', { name: /étapes/ })).toBeNull();

    const l21 = document.getElementById('L21')!;
    expect(within(l21).getByText('Livré le 28 septembre 2026')).toBeInTheDocument();
    expect(within(l21).getByRole('progressbar')).toHaveAttribute('aria-valuetext', '2 étapes faites sur 2');
    const link = await within(l21).findByRole('link', { name: 'Voir la nouveauté : Un tableau de bord plus lisible' });
    expect(link).toHaveAttribute('href', '/nouveautes#2026-09-28-tableau');
  });

  it('« Voir les étapes » déplie les étapes publiques puis devient « Masquer les étapes »', async () => {
    vi.stubGlobal('fetch', serve(okJson(plan)));
    renderPage();
    const l21 = (await screen.findByRole('heading', { level: 3, name: 'Un tableau de bord plus lisible' })).closest('li')!;
    const toggle = within(l21).getByRole('button', { name: 'Voir les étapes : Un tableau de bord plus lisible' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(l21).queryByText('Textes plus contrastés')).toBeNull();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAccessibleName('Masquer les étapes : Un tableau de bord plus lisible');
    expect(within(l21).getByText('Textes plus contrastés')).toBeInTheDocument();
  });

  it('défile jusqu’à la carte de l’ancre /plan#<id>', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    window.location.hash = '#L21';
    vi.stubGlobal('fetch', serve(okJson(plan)));
    renderPage();
    await screen.findByRole('heading', { level: 3, name: 'Un tableau de bord plus lisible' });
    expect(scroll).toHaveBeenCalled();
    expect(scroll.mock.contexts[0]).toBe(document.getElementById('L21'));
  });

  it('404 : « Aucun plan publié »', async () => {
    vi.stubGlobal('fetch', serve({ ok: false, status: 404 }));
    renderPage();
    expect(await screen.findByText(/Aucun plan publié/)).toBeInTheDocument();
  });

  it('panne (500, non JSON) : message d’erreur et « Réessayer » qui recharge', async () => {
    const fetchMock = serve({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Le plan n'a pas pu être chargé");
    const calls = fetchMock.mock.calls.filter(([u]) => u.startsWith('/plan-data')).length;
    fetchMock.mockImplementation((url: string) => Promise.resolve(url.startsWith('/plan-data') ? okJson(plan) : okJson(news)));
    await userEvent.click(within(alert).getByRole('button', { name: /Réessayer/ }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Une page Plan de travail' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([u]) => u.startsWith('/plan-data')).length).toBe(calls + 1);
  });

  it('les trois groupes vides : un seul état vide avec lien vers les Nouveautés', async () => {
    vi.stubGlobal('fetch', serve(okJson({ ...plan, lots: [plan.lots[2]] })));
    renderPage();
    expect(await screen.findByText("Rien en préparation pour l'instant.")).toBeInTheDocument();
    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0);
    expect(screen.getByRole('link', { name: /Nouveautés/ })).toHaveAttribute('href', '/nouveautes');
  });

  it('dit « rien » dans un groupe vide', async () => {
    vi.stubGlobal('fetch', serve(okJson({ ...plan, lots: plan.lots.filter((l) => l.status !== 'doing') }), { ok: false, status: 404 }));
    renderPage();
    const doing = await screen.findByRole('region', { name: /En cours/ });
    expect(within(doing).getByText(/Rien en cours/)).toBeInTheDocument();
  });
});
