import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NewsPage } from './news';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NewsPage />
    </QueryClientProvider>,
  );
}

describe('<NewsPage />', () => {
  afterEach(() => vi.unstubAllGlobals());

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

  it('says so when the journal is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    renderPage();
    expect(await screen.findByText(/Aucune nouveauté publiée/)).toBeInTheDocument();
  });
});
