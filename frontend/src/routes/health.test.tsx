import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HealthPage } from './health';
import type { HealthAdvice, HealthDiagnostic, HealthThresholds } from '@/types/api';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({
  api,
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

const block = (status: 'green' | 'orange' | 'red', details: Record<string, number | string | null> = {}) => ({
  status,
  thresholdHit: null,
  details,
});

const diagnostic = (over: Partial<HealthDiagnostic> = {}): HealthDiagnostic => ({
  verdict: 'orange',
  causes: ['Taux d\'effort élevé'],
  blocks: {
    resteAVivre: block('green', { resteAVivre: 800, income: 2400 }),
    chargeDette: block('orange', { tauxEffortPct: 38 }),
    fluxTirages: block('green', { flux: -120 }),
    trajectoire: block('orange', { sumUsed: 1000, sumProjected: 1200, horizonMonths: 6 }),
  },
  income: { monthly: 2400, source: 'detected', label: null },
  reliability: 'ok',
  computedAt: '2026-10-01T00:00:00Z',
  ...over,
});

const thresholds: HealthThresholds = {
  resteAVivre: { orangeBelowPctIncome: 25 },
  tauxEffort: { orangeAbovePct: 33, redAbovePct: 40 },
  plafonds: { greenBelowPct: 30, redAbovePct: 80 },
  tirages: { redAbovePctIncome: 15 },
  trajectoire: { horizonMonths: 6, stableBandPct: 5 },
  manualMonthlyIncome: null,
};

type Routes = {
  diagnostic?: HealthDiagnostic | Error;
  thresholds?: HealthThresholds | Error;
  advice?: HealthAdvice | undefined | Error;
};

function route(r: Routes = {}) {
  const value = (v: unknown) => (v instanceof Error ? Promise.reject(v) : Promise.resolve(v));
  api.get.mockImplementation((url: string) => {
    if (url === '/health-check/diagnostic') return value(r.diagnostic ?? diagnostic());
    if (url === '/health-check/thresholds') return value(r.thresholds ?? thresholds);
    if (url === '/health-check/advice') return value(r.advice);
    return Promise.reject(new Error(`GET inattendu ${url}`));
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HealthPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom n'a pas ResizeObserver (recharts, graphique de trajectoire).
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  route();
});

describe('Santé financière (/health) — revue UX (L37)', () => {
  it('R1 — diagnostic en échec : message et Réessayer, qui relance la lecture', async () => {
    route({ diagnostic: new Error('boom') });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de charger le diagnostic');
    route();
    await userEvent.click(screen.getByRole('button', { name: /Réessayer/ }));
    expect(await screen.findByText('Trajectoire 6 mois')).toBeTruthy();
  });

  it('R2 — le tiroir des seuils prend le focus, le garde (Tab bouclé), le rend à Échap', async () => {
    renderPage();
    const opener = await screen.findByRole('button', { name: /Ajuster les seuils/ });
    await userEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Ajuster les seuils' });
    const first = await within(dialog).findByLabelText(/Orange en-dessous de/);
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    // Maj+Tab depuis le premier champ ne sort pas du tiroir.
    first.focus();
    await userEvent.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('R3 — le bouton de fermeture du tiroir a un nom', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Ajuster les seuils/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('R4 — seuils illisibles : message et Réessayer dans le tiroir, jamais « Chargement… » sans fin', async () => {
    route({ thresholds: new Error('boom') });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Ajuster les seuils/ }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Impossible de charger les seuils');
    expect(within(dialog).queryByText('Chargement…')).toBeNull();
    route();
    await userEvent.click(within(dialog).getByRole('button', { name: /Réessayer/ }));
    expect(await within(dialog).findByLabelText(/Orange en-dessous de/)).toBeTruthy();
  });

  it('R5 — « Restaurer les défauts » en échec : message dans le tiroir (aucun rejet non géré)', async () => {
    api.post.mockRejectedValue(new Error('boom'));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Ajuster les seuils/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(await within(dialog).findByRole('button', { name: /Restaurer les défauts/ }));
    expect(await within(dialog).findByText(/Échec de la restauration/)).toBeTruthy();
  });

  it('R6 — seuil invalide : erreur annoncée (alert), lisible (text-negative-fg), focus sur le premier champ fautif', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Ajuster les seuils/ }));
    const dialog = await screen.findByRole('dialog');
    const field = await within(dialog).findByLabelText(/Orange en-dessous de/);
    await userEvent.clear(field);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    const message = await within(dialog).findByText(/Seuils invalides/);
    expect(message.closest('[role="alert"]')).not.toBeNull();
    expect(message.className).toContain('text-negative-fg');
    // En tête du formulaire : visible depuis le champ fautif, même au téléphone.
    expect(message.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.activeElement).toBe(field);
    expect(api.put).not.toHaveBeenCalled();
  });

  it('R7 — enregistrement des seuils : succès annoncé (status), échec annoncé (alert)', async () => {
    api.put.mockResolvedValueOnce(thresholds);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Ajuster les seuils/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Seuils enregistrés.');
    api.put.mockRejectedValueOnce(new Error('boom'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText("Échec de l'enregistrement.")).toBeTruthy();
  });

  it('R8 — revenu manuel : champ nommé, valeur invalide dite, échec annoncé lisible, succès annoncé', async () => {
    route({ diagnostic: diagnostic({ reliability: 'unavailable', income: { monthly: null, source: 'unavailable', label: null } }) });
    api.put.mockRejectedValueOnce(new Error('boom'));
    renderPage();
    const field = await screen.findByLabelText('Revenu mensuel (€)');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Saisis un montant supérieur à 0');
    await userEvent.type(field, '2400');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    const failure = await screen.findByRole('alert');
    expect(failure).toHaveTextContent("Échec de l'enregistrement.");
    expect(failure.querySelector('.text-negative-fg')).not.toBeNull();
    api.put.mockResolvedValueOnce(thresholds);
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Revenu manuel enregistré.');
  });

  it('R9 — conseils : lecture en échec dite (alert), jamais le texte « Aucun conseil généré »', async () => {
    route({ advice: new Error('boom') });
    renderPage();
    const alert = await screen.findByText(/Impossible de lire les conseils/);
    expect(alert.closest('[role="alert"]')).not.toBeNull();
    expect(screen.queryByText(/Aucun conseil généré/)).toBeNull();
  });

  it('R10 — conseils : la génération en cours et son échec sont annoncés', async () => {
    let fail: (e: Error) => void = () => {};
    api.post.mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Générer les conseils/ }));
    expect(screen.getByRole('status')).toHaveTextContent('Génération des conseils en cours');
    fail(new Error('Ollama injoignable'));
    expect(await screen.findByText(/Conseils indisponibles/)).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveTextContent('Ollama injoignable');
  });

  it('R11 — trajectoire : le graphique a une alternative texte avec les deux valeurs', async () => {
    renderPage();
    await screen.findByText('Trajectoire 6 mois');
    const chart = screen.getByRole('img', { name: /Encours actuel.*projeté/ });
    expect(chart.getAttribute('aria-label')).toMatch(/1\s?000,00\s?€/);
    expect(chart.getAttribute('aria-label')).toMatch(/1\s?200,00\s?€/);
  });

  it('R12 — aucun conseil encore généré (204) : invitation à générer, pas une erreur', async () => {
    renderPage();
    expect(await screen.findByText(/Aucun conseil généré pour l'instant/)).toBeTruthy();
    expect(screen.queryByText(/Impossible de lire les conseils/)).toBeNull();
  });

  it('R13 — le bandeau verdict dit le verdict en mots (badge) et liste les causes', async () => {
    renderPage();
    expect(await screen.findByText('Ta situation financière mérite une vigilance particulière.')).toBeTruthy();
    expect(screen.getByText("Taux d'effort élevé")).toBeTruthy();
    expect(screen.getAllByText('Orange').length).toBeGreaterThan(0);
  });
});
