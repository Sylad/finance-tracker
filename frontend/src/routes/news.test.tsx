import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NewsPage } from './news';
import { NEWS_SEEN_EVENT, NEWS_SEEN_KEY } from '@/lib/news-badge';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, hash, children, ...rest }: { to: string; hash?: string; children: React.ReactNode }) => (
    <a href={hash ? `${to}#${hash}` : to} {...rest}>{children}</a>
  ),
}));

function renderPage(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={client}>
      <NewsPage />
    </QueryClientProvider>,
  );
}

// ── L47 : marques « Nouveau », séparateur, lien permanent ──────────────────────
const NEWS = {
  project: 'finance-tracker',
  generated: '2026-10-01 22:00',
  entries: [
    { slug: '2026-10-01-page', title: 'Une page Plan de travail', date: '2026-10-01', lots: [], captures: [], html: '<p>Plan.</p>' },
    { slug: '2026-09-28-ancienne', title: 'Une nouveauté plus ancienne', date: '2026-09-28', lots: [], captures: [], html: '<p>Avant.</p>' },
  ],
};

function stubNews(news: unknown = NEWS) {
  const fetchMock = vi.fn(async (url: string) =>
    url.endsWith('/nouveautes.json')
      ? { ok: true, status: 200, json: async () => news }
      : { ok: false, status: 404, json: async () => null },
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const remember = (v: unknown) => localStorage.setItem(NEWS_SEEN_KEY, JSON.stringify(v));
const stored = () => JSON.parse(localStorage.getItem(NEWS_SEEN_KEY) ?? 'null');
const setClipboard = (writeText: (s: string) => Promise<void>) =>
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

describe('<NewsPage />', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/nouveautes');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('lists entries from the cadence JSON with their screenshots', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        project: 'finance-tracker',
        generated: '2026-09-29 10:12',
        entries: [
          {
            slug: '2026-09-29-page',
            title: 'Une page Nouveautés',
            date: '2026-09-29',
            lots: ['L18'],
            captures: ['captures/l18.png'],
            html: '<p>Le <strong>journal</strong> des changements.</p>',
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Une page Nouveautés' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/nouveautes-data/nouveautes.json', expect.anything());
    expect(screen.getByText('journal').tagName).toBe('STRONG');
    expect(screen.getByRole('img', { name: 'Capture : Une page Nouveautés' })).toHaveAttribute(
      'src',
      '/nouveautes-data/captures/l18.png',
    );
    expect(screen.getByText('29 septembre 2026')).toBeInTheDocument();
  });

  it('links an entry to its lot in the work plan when the lot is published there', async () => {
    const entry = (slug: string, title: string, lots: string[]) => ({ slug, title, date: '2026-09-29', lots, captures: [], html: '' });
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(url.startsWith('/plan-data')
      ? { ok: true, status: 200, json: async () => ({ version: 1, project: 'x', lots: [{ id: 'L21', title: 'Tableau', status: 'done' }] }) }
      : { ok: true, status: 200, json: async () => ({ project: 'x', generated: 'x', entries: [entry('a', 'Tableau revu', ['L21']), entry('b', 'Autre', ['L9'])] }) })));
    renderPage();
    const link = await screen.findByRole('link', { name: 'Dans le plan de travail : Tableau revu' });
    expect(link).toHaveAttribute('href', '/plan#L21');
    expect(screen.getAllByRole('link', { name: /Dans le plan de travail/ })).toHaveLength(1);
  });

  it('says so when the journal is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    renderPage();
    expect(await screen.findByText(/Aucune nouveauté publiée/)).toBeInTheDocument();
  });

  it('date en toutes lettres avec « 1er », jamais coupée en son milieu', async () => {
    stubNews();
    renderPage();
    const time = await screen.findByText('1er octobre 2026');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('dateTime', '2026-10-01');
    expect(time.className).toMatch(/whitespace-nowrap/);
  });

  it('premier visiteur : aucune marque « Nouveau », aucune annonce ; la visite est mémorisée et annoncée à la navigation', async () => {
    stubNews();
    const seenEvent = vi.fn();
    window.addEventListener(NEWS_SEEN_EVENT, seenEvent);
    renderPage();
    await screen.findByRole('heading', { level: 2, name: 'Une page Plan de travail' });
    await waitFor(() => expect(stored()).toMatchObject({ date: '2026-10-01', slugs: ['2026-10-01-page'] }));
    expect(stored().at).toEqual(expect.any(String));
    expect(seenEvent).toHaveBeenCalled();
    window.removeEventListener(NEWS_SEEN_EVENT, seenEvent);
    expect(screen.queryByText('Nouveau')).toBeNull();
    expect(screen.getByTestId('nouveautes-depuis')).toHaveTextContent('');
    expect(screen.queryByTestId('nouveautes-deja-vu')).toBeNull();
  });

  it('après une visite ancienne : « Nouveau » en toutes lettres sur chaque entrée non vue, annonce role=status, marques gardées pendant la visite', async () => {
    stubNews();
    remember({ date: '2026-01-01', slugs: [], seen: [], at: '2026-01-01T10:00:00.000Z' });
    renderPage();
    await screen.findByRole('heading', { level: 2, name: 'Une page Plan de travail' });
    expect(screen.getAllByText('Nouveau')).toHaveLength(2);
    const since = screen.getByTestId('nouveautes-depuis');
    expect(since).toHaveAttribute('role', 'status');
    expect(since).toHaveTextContent('2 nouveautés depuis votre dernière visite');
    expect(screen.queryByTestId('nouveautes-deja-vu')).toBeNull();
    await waitFor(() => expect(stored().date).toBe('2026-10-01'));
    expect(screen.getAllByText('Nouveau')).toHaveLength(2);
  });

  it('séparateur « Déjà vu lors de votre visite du … » avant la première entrée déjà vue, hors de toute liste', async () => {
    stubNews();
    const at = '2026-09-29T08:30:00.000Z';
    remember({ date: '2026-09-28', slugs: ['2026-09-28-ancienne'], seen: ['2026-09-28-ancienne'], at });
    renderPage();
    await screen.findByRole('heading', { level: 2, name: 'Une page Plan de travail' });
    expect(screen.getAllByText('Nouveau')).toHaveLength(1);
    expect(screen.getByTestId('nouveautes-depuis')).toHaveTextContent('1 nouveauté depuis votre dernière visite');
    const sep = screen.getByTestId('nouveautes-deja-vu');
    expect(sep).toHaveTextContent(/^Déjà vu lors de votre visite du 29 septembre 2026 à \d\d:30$/);
    expect(sep.tagName).toBe('DIV');
    expect(sep.parentElement!.tagName).not.toMatch(/^(UL|OL)$/);
    expect(sep.nextElementSibling).toHaveAttribute('id', '2026-09-28-ancienne');
    expect(within(document.getElementById('2026-10-01-page')!).getByText('Nouveau')).toBeInTheDocument();
  });

  it('nouvelle entrée antidatée sous une entrée déjà vue : marquée « Nouveau », sans séparateur trompeur', async () => {
    stubNews();
    remember({ date: '2026-10-01', slugs: ['2026-10-01-page'], seen: ['2026-10-01-page'], at: '2026-10-01T20:00:00.000Z' });
    renderPage();
    await screen.findByRole('heading', { level: 2, name: 'Une page Plan de travail' });
    expect(within(document.getElementById('2026-09-28-ancienne')!).getByText('Nouveau')).toBeInTheDocument();
    expect(within(document.getElementById('2026-10-01-page')!).queryByText('Nouveau')).toBeNull();
    expect(screen.queryByTestId('nouveautes-deja-vu')).toBeNull();
  });

  it('ligne de base (sans instant de visite) : « Nouveau » sur l’entrée publiée depuis ; séparateur « Déjà publié lors de votre première visite »', async () => {
    stubNews();
    remember({ date: '2026-09-28', slugs: ['2026-09-28-ancienne'], seen: ['2026-09-28-ancienne'] });
    renderPage();
    await screen.findByRole('heading', { level: 2, name: 'Une page Plan de travail' });
    expect(within(document.getElementById('2026-10-01-page')!).getByText('Nouveau')).toBeInTheDocument();
    expect(screen.getByTestId('nouveautes-depuis')).toHaveTextContent('1 nouveauté depuis votre dernière visite');
    expect(screen.getByTestId('nouveautes-deja-vu')).toHaveTextContent(
      "Déjà publié lors de votre première visite de l'application",
    );
  });

  it('le titre est du texte simple (aucun lien, aucune copie) ; ordre clavier : « Copier le lien » de la 1re entrée', async () => {
    stubNews();
    const user = userEvent.setup();
    renderPage();
    const h2 = await screen.findByRole('heading', { level: 2, name: 'Une page Plan de travail' });
    expect(h2.querySelector('a')).toBeNull();
    expect(h2).toHaveAttribute('id', '2026-10-01-page-titre');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Copier le lien : Une page Plan de travail' })).toHaveFocus();
  });

  it('« Copier le lien » : cible 44 px au toucher, 24 px au bureau ; copie sans toucher à l’adresse ; retour dans le libellé à largeur réservée', async () => {
    stubNews();
    const user = userEvent.setup();
    renderPage();
    const button = await screen.findByRole('button', { name: 'Copier le lien : Une page Plan de travail' });
    expect(button.className).toMatch(/(^| )min-h-11( |$)/);
    expect(button.className).toMatch(/lg:min-h-6/);
    expect(button.className).toMatch(/\[@media\(pointer:coarse\)\]:min-h-11/);
    const labels = [...button.querySelectorAll('[data-label]')].map((n) => n.textContent);
    expect(labels).toEqual(['Copier le lien', 'Lien copié', 'Copie impossible']);
    const visible = (b: HTMLElement) =>
      [...b.querySelectorAll('[data-label]')].filter((n) => !n.className.includes('invisible')).map((n) => n.textContent);
    expect(visible(button)).toEqual(['Copier le lien']);

    const writeText = vi.fn(async () => {});
    setClipboard(writeText);
    await user.click(button);
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/nouveautes#2026-10-01-page`);
    expect(window.location.hash).toBe('');
    expect(visible(button)).toEqual(['Lien copié']);
    const article = document.getElementById('2026-10-01-page')!;
    const status = within(article).getByRole('status');
    expect(status).toHaveTextContent('Lien copié dans le presse-papiers');
    expect(status.className).toMatch(/(^| )sr-only( |$)/);
    expect(article).not.toHaveAttribute('data-target');
    expect(within(article).queryByTestId('nouveautes-adresse')).toBeNull();
  });

  it('copie refusée : « Copie impossible » dans le libellé, adresse affichée sous le titre, sélectionnable', async () => {
    stubNews();
    const user = userEvent.setup();
    renderPage();
    const button = await screen.findByRole('button', { name: 'Copier le lien : Une nouveauté plus ancienne' });
    setClipboard(vi.fn(async () => Promise.reject(new Error('refusé'))));
    await user.click(button);
    const article = document.getElementById('2026-09-28-ancienne')!;
    await waitFor(() =>
      expect([...button.querySelectorAll('[data-label]')].filter((n) => !n.className.includes('invisible')).map((n) => n.textContent)).toEqual(['Copie impossible']),
    );
    const address = within(article).getByTestId('nouveautes-adresse');
    expect(address).toHaveTextContent(`${window.location.origin}/nouveautes#2026-09-28-ancienne`);
    expect(address.innerHTML).toMatch(/select-all/);
    const h2 = within(article).getByRole('heading', { level: 2 });
    expect(h2.compareDocumentPosition(address) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(article).getByRole('status')).toHaveTextContent(
      `Copie impossible. Adresse de cette nouveauté : ${window.location.origin}/nouveautes#2026-09-28-ancienne`,
    );
    // Sans presse-papiers du tout : même repli.
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    await user.click(screen.getByRole('button', { name: 'Copier le lien : Une page Plan de travail' }));
    expect(await within(document.getElementById('2026-10-01-page')!).findByTestId('nouveautes-adresse')).toBeInTheDocument();
  });

  it('arrivée sur /nouveautes#<slug> : l’entrée visée est signalée, amenée à l’écran et reçoit le focus', async () => {
    stubNews();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    window.history.replaceState(null, '', '/nouveautes#2026-09-28-ancienne');
    renderPage();
    await screen.findByRole('heading', { level: 2, name: 'Une nouveauté plus ancienne' });
    const target = document.getElementById('2026-09-28-ancienne')!;
    await waitFor(() => expect(target).toHaveFocus());
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(target).toHaveAttribute('data-target', 'true');
    expect(target).toHaveAttribute('tabindex', '-1');
    // Pas cachée sous l'en-tête fixe du téléphone (56 px).
    expect(target.className).toMatch(/scroll-mt-20/);
    expect(document.getElementById('2026-10-01-page')).not.toHaveAttribute('data-target');
  });

  it('changement d’ancre (hashchange) : la nouvelle entrée est signalée ; ancre inconnue : aucune', async () => {
    stubNews();
    renderPage();
    await screen.findByRole('heading', { level: 2, name: 'Une page Plan de travail' });
    act(() => {
      window.history.replaceState(null, '', '/nouveautes#2026-10-01-page');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(document.getElementById('2026-10-01-page')).toHaveAttribute('data-target', 'true');
    act(() => {
      window.history.replaceState(null, '', '/nouveautes#inconnu');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(document.querySelector('[data-target]')).toBeNull();
  });

  it('un rechargement du journal en arrière-plan ne refait ni défilement ni focus vers l’ancre déjà visée', async () => {
    const fetchMock = stubNews();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    window.history.replaceState(null, '', '/nouveautes#2026-09-28-ancienne');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPage(client);
    await screen.findByRole('heading', { level: 2, name: 'Une nouveauté plus ancienne' });
    await waitFor(() => expect(document.getElementById('2026-09-28-ancienne')).toHaveFocus());
    expect(scroll).toHaveBeenCalledTimes(1);

    const elsewhere = screen.getByRole('button', { name: 'Copier le lien : Une page Plan de travail' });
    elsewhere.focus();
    const calls = fetchMock.mock.calls.length;
    const extra = { ...NEWS.entries[0], slug: '2026-10-02-plus-recente', title: 'Plus récente' };
    stubNews({ ...NEWS, entries: [extra, ...NEWS.entries] });
    await act(async () => {
      await client.refetchQueries();
    });
    expect(fetchMock.mock.calls.length).toBe(calls);
    expect(await screen.findByRole('heading', { level: 2, name: 'Plus récente' })).toBeInTheDocument();
    expect(elsewhere).toHaveFocus();
    expect(scroll).toHaveBeenCalledTimes(1);
  });
});
