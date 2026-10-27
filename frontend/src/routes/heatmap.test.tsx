import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HeatmapPage } from './heatmap';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));

const year = new Date().getFullYear();
const statement = {
  id: 's1', year, month: 1,
  transactions: [
    { date: `${year}-01-10`, amount: -40 },
    { date: `${year}-01-10`, amount: -10 },
    { date: `${year}-01-12`, amount: -5 },
    { date: `${year}-01-13`, amount: 2000 },
  ],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><HeatmapPage /></QueryClientProvider>);
}

function route(summaries: unknown, detail: unknown = statement) {
  api.get.mockImplementation(async (url: string) => {
    if (url === '/statements') {
      if (summaries instanceof Error) throw summaries;
      return summaries;
    }
    if (detail instanceof Error) throw detail;
    return detail;
  });
}

describe('Heatmap des dépenses — revue UX (L36)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    route([{ id: 's1' }]);
  });

  it('R1 — chargement en échec : message et Réessayer, jamais un spinner sans fin', async () => {
    route(new Error('boom'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de charger la heatmap');
    expect(screen.queryByText(/Agrégation/)).toBeNull();
    route([{ id: 's1' }]);
    await userEvent.click(screen.getByRole('button', { name: /Réessayer/ }));
    expect(await screen.findByText(/Top 5 journées/)).toBeTruthy();
  });

  it('R2 — échec d’un relevé détaillé : même message avec Réessayer', async () => {
    route([{ id: 's1' }], new Error('détail'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de charger la heatmap');
    expect(screen.getByRole('button', { name: /Réessayer/ })).toBeTruthy();
  });

  it('R3 — aucun relevé : état vide explicite, plus de « Agrégation… » sans fin', async () => {
    route([]);
    renderPage();
    expect(await screen.findByText('Aucun relevé importé')).toBeTruthy();
    expect(screen.queryByText(/Agrégation/)).toBeNull();
  });

  it('R4 — le sélecteur de période porte un nom', async () => {
    renderPage();
    expect(await screen.findByRole('combobox', { name: 'Période' })).toBeTruthy();
  });

  it('R5 — la grille a un équivalent texte : jours avec débit, total et jour le plus dépensier', async () => {
    renderPage();
    const img = await screen.findByRole('img', { name: /Heatmap des dépenses/ });
    const label = img.getAttribute('aria-label') ?? '';
    expect(label).toContain('2 jours avec débit');
    expect(label).toContain('55,00');
    expect(label).toMatch(/10 janvier/);
    expect(label).toContain('50,00');
  });

  it('R6 — toucher ou cliquer une case affiche son jour et son montant (pas seulement au survol)', async () => {
    renderPage();
    await screen.findByRole('img', { name: /Heatmap des dépenses/ });
    const cell = document.querySelector(`[data-date="${year}-01-10"]`) as HTMLElement;
    expect(cell).toBeTruthy();
    await userEvent.click(cell);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('10 janvier');
    expect(status).toHaveTextContent('50,00');
  });

  it('R7 — la grille défile jusqu’aux mois récents à l’ouverture', async () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(900);
    renderPage();
    await screen.findByRole('img', { name: /Heatmap des dépenses/ });
    const scroller = document.querySelector('[data-heatmap-scroll]') as HTMLElement;
    expect(scroller.scrollLeft).toBe(900);
    spy.mockRestore();
  });

  it('R8 — l’axe des mois et la légende ne descendent pas sous 11 px', async () => {
    renderPage();
    await screen.findByRole('img', { name: /Heatmap des dépenses/ });
    expect(document.body.innerHTML).not.toMatch(/text-\[(9|10)px\]/);
  });
});

describe('Heatmap — lecture visible sans défiler (L36)', () => {
  it('R10 — la ligne de lecture et la légende restent hors de la zone qui défile', async () => {
    route([{ id: 's1' }]);
    renderPage();
    await screen.findByRole('img', { name: /Heatmap des dépenses/ });
    const scroller = document.querySelector('[data-heatmap-scroll]') as HTMLElement;
    expect(scroller.contains(screen.getByRole('status'))).toBe(false);
    expect(scroller.contains(screen.getByText(/jours? avec débit · total/))).toBe(false);
  });
});
