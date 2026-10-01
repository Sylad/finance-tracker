import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlanPage } from './plan';

// Le lien vers la Nouveauté passe par le routeur ; un <a> suffit ici.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, hash, children, ...rest }: { to: string; hash?: string; children: React.ReactNode }) => (
    <a href={hash ? `${to}#${hash}` : to} {...rest}>{children}</a>
  ),
}));

const plan = {
  version: 1,
  project: 'finance-tracker',
  lots: [
    { id: 'L18', title: 'Page Nouveautés', status: 'done', started: '2026-09-28', finished: '2026-09-28' },
    { id: 'L21', title: 'Revue UX — Tableau de bord', status: 'done', started: '2026-09-28', finished: '2026-09-28',
      tasks: [{ title: 'Contraste', status: 'done' }, { title: 'Clavier', status: 'done' }] },
    { id: 'L3', title: 'Très ancien', status: 'done', finished: '2026-06-01' },
    { id: 'L47', title: 'Pastille nouveau', status: 'todo' },
    { id: 'L48', title: 'Page Plan de travail', status: 'doing', started: '2026-10-01',
      tasks: [{ title: 'a', status: 'done' }, { title: 'b', status: 'todo' }] },
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

// Le texte est coupé par des <time> : on compare le paragraphe entier.
const para = (re: RegExp) => (_: string, el: Element | null) => el?.tagName === 'P' && re.test(el.textContent ?? '');

const okJson = (body: unknown) => ({ ok: true, json: async () => body });

describe('<PlanPage />', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T10:00:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('montre En cours, Prévu puis Récemment livré, avec dates et avancement', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(url.startsWith('/plan-data') ? okJson(plan) : okJson(news)),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    const headings = await screen.findAllByRole('heading', { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual([
      expect.stringContaining('En cours'),
      expect.stringContaining('Prévu'),
      expect.stringContaining('Récemment livré'),
    ]);
    expect(fetchMock).toHaveBeenCalledWith('/plan-data/plan.json', expect.anything());
    expect(screen.getByText('1 lot en cours, 1 prévu, 2 livrés ces 30 derniers jours.')).toBeInTheDocument();

    const doing = screen.getByRole('region', { name: /En cours/ });
    expect(within(doing).getByRole('heading', { level: 3, name: /Page Plan de travail/ })).toBeInTheDocument();
    expect(within(doing).getByText(para(/^Démarré le 1 octobre 2026 \(aujourd'hui\)$/))).toBeInTheDocument();
    expect(within(doing).getByText('1/2 sous-tâches')).toBeInTheDocument();

    const done = screen.getByRole('region', { name: /Récemment livré/ });
    expect(within(done).getByText('2/2 sous-tâches')).toBeInTheDocument();
    expect(within(done).getAllByText(para(/^Livré le 28 septembre 2026 \(il y a 3 jours\)$/))).toHaveLength(2);
    expect(within(done).queryByText('Très ancien')).not.toBeInTheDocument();
    expect(within(done).getByText(/1 lot livré plus ancien/)).toBeInTheDocument();

    // L21 a une entrée Nouveautés : lien vers elle.
    expect(await within(done).findByRole('link', { name: /Voir la nouveauté/ })).toHaveAttribute(
      'href',
      '/nouveautes#2026-09-28-tableau',
    );
  });

  it('le dit quand le plan est absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    renderPage();
    expect(await screen.findByText(/Aucun plan publié/)).toBeInTheDocument();
  });

  it('dit « rien » dans un groupe vide', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) =>
      Promise.resolve(url.startsWith('/plan-data')
        ? okJson({ ...plan, lots: plan.lots.filter((l) => l.status !== 'doing') })
        : { ok: false, status: 404 }),
    ));
    renderPage();
    const doing = await screen.findByRole('region', { name: /En cours/ });
    expect(within(doing).getByText(/Rien en cours/)).toBeInTheDocument();
  });
});
