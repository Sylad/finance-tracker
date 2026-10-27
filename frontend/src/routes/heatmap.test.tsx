import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HeatmapPage } from './heatmap';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));

// Horloge figée : la page s'ouvre sur « 12 derniers mois », la fixture doit y rester quelle que soit la date du jour.
const NOW = new Date(2026, 5, 15, 12);
const year = NOW.getFullYear();
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

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

// Deux relevés : un jour au tout début de la fenêtre « 12 derniers mois » (2025-06-16,
// NOW = 2026-06-15) et deux jours à égalité en fin d'année 2026 (31 et 30 décembre).
const EARLY = { id: 'early', year: 2025, month: 6, transactions: [{ date: '2025-06-16', amount: -30 }] };
const LATE = {
  id: 'late', year: 2026, month: 12,
  transactions: [
    { date: '2026-12-31', amount: -70 },
    { date: '2026-12-30', amount: -70 },
    { date: '2026-12-01', amount: -5 },
  ],
};

function routeMany(details: Record<string, unknown>) {
  api.get.mockImplementation(async (url: string) => {
    if (url === '/statements') return Object.keys(details).map((id) => ({ id }));
    return details[url.replace('/statements/', '')];
  });
}

const top5Rows = () => Array.from(document.querySelectorAll('.divide-y > div')).map((r) => r.textContent ?? '');

describe('Heatmap — Top 5 cohérent avec la grille (L36)', () => {
  // Le bug ne se voit qu'avec un fuseau à l'est d'UTC : Date.parse('YYYY-MM-DD') est minuit UTC,
  // `to` (31 déc. minuit local) est AVANT. Fuseau forcé pour ce bloc, quel que soit celui de la machine.
  const tz = process.env.TZ;
  beforeEach(() => { process.env.TZ = 'Europe/Paris'; vi.clearAllMocks(); routeMany({ early: EARLY, late: LATE }); });
  afterEach(() => { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; });

  it('R13 — en vue « année », le 31 décembre est dans le Top 5 comme dans la grille', async () => {
    renderPage();
    await screen.findByRole('img', { name: /Heatmap des dépenses/ });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Période' }), '2026');
    expect(document.querySelector('[data-date="2026-12-31"]')).toBeTruthy();
    expect(screen.getByRole('img', { name: /Heatmap des dépenses/ }).getAttribute('aria-label')).toContain('145,00');
    expect(top5Rows().some((r) => r.includes('31 décembre 2026'))).toBe(true);
  });

  it('R13 — en « 12 derniers mois », le premier jour de la fenêtre est dans le Top 5 comme dans la grille', async () => {
    renderPage();
    await screen.findByRole('img', { name: /Heatmap des dépenses/ });
    expect(document.querySelector('[data-date="2025-06-16"]')).toBeTruthy();
    expect(top5Rows().some((r) => r.includes('16 juin 2025'))).toBe(true);
  });
});

describe('Heatmap — ligne de lecture et période (L36)', () => {
  beforeEach(() => { vi.clearAllMocks(); routeMany({ early: EARLY, late: LATE }); });

  it('R14 — changer de période efface le jour choisi, qui n’est plus affiché', async () => {
    renderPage();
    await screen.findByRole('img', { name: /Heatmap des dépenses/ });
    await userEvent.click(document.querySelector('[data-date="2025-06-16"]') as HTMLElement);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('16 juin 2025');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Période' }), '2026');
    expect(document.querySelector('[data-date="2025-06-16"]')).toBeNull();
    expect(status).not.toHaveTextContent('2025');
    expect(status).toHaveTextContent(/Touche ou survole/);
  });
});

describe('Heatmap — départage à égalité (L36)', () => {
  beforeEach(() => { vi.clearAllMocks(); routeMany({ early: EARLY, late: LATE }); });

  it('R15 — à montant égal, le résumé et le Top 5 nomment la même journée (la plus récente)', async () => {
    renderPage();
    await screen.findByRole('img', { name: /Heatmap des dépenses/ });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Période' }), '2026');
    const label = screen.getByRole('img', { name: /Heatmap des dépenses/ }).getAttribute('aria-label') ?? '';
    const summaryDay = label.match(/Journée la plus dépensière : ([^,]+),/)?.[1];
    expect(summaryDay).toBe('jeudi 31 décembre 2026');
    const rows = top5Rows();
    expect(rows[0]).toContain('31 décembre 2026');
    expect(rows[1]).toContain('30 décembre 2026');
  });
});

describe('Heatmap — lecture au clavier (L36)', () => {
  it('R11 — un seul arrêt de tabulation sur la grille, les flèches lisent un jour quelconque', async () => {
    route([{ id: 's1' }]);
    renderPage();
    await screen.findByRole('img', { name: /Heatmap des dépenses/ });
    const scroller = document.querySelector('[data-heatmap-scroll]') as HTMLElement;
    expect(scroller.tabIndex).toBe(0);
    expect(scroller.getAttribute('aria-label')).toMatch(/flèches/);
    // Un arrêt unique : les cases ne sont pas elles-mêmes tabulables.
    expect(document.querySelectorAll('[data-date][tabindex]').length).toBe(0);
    await userEvent.click(document.querySelector(`[data-date="${year}-01-10"]`) as HTMLElement);
    scroller.focus();
    const status = screen.getByRole('status');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(status).toHaveTextContent('12 janvier');
    expect(status).toHaveTextContent('5,00');
    await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowRight}');
    expect(status).toHaveTextContent('17 janvier');
    await userEvent.keyboard('{ArrowLeft}');
    expect(status).toHaveTextContent('10 janvier');
    expect(status).toHaveTextContent('50,00');
    expect(document.querySelector(`[data-date="${year}-01-10"]`)?.getAttribute('data-selected')).toBe('true');
  });

  it('R11 — sans sélection, une flèche ouvre sur le jour le plus récent', async () => {
    route([{ id: 's1' }]);
    renderPage();
    await screen.findByRole('img', { name: /Heatmap des dépenses/ });
    (document.querySelector('[data-heatmap-scroll]') as HTMLElement).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('status').textContent).not.toMatch(/Touche ou survole/);
  });
});
