import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IncomePage } from './income';
import type { RecurringCredit } from '@/types/api';

const state = vi.hoisted(() => ({
  q: { isLoading: false, isError: false, isFetching: false, data: [] as unknown[] | undefined, refetch: vi.fn() },
}));

vi.mock('@/lib/queries', () => ({ useRecurringCredits: () => state.q }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => <a href={to} {...rest}>{children}</a>,
}));

const credit = (o: Partial<RecurringCredit>): RecurringCredit => ({
  id: 'x', description: 'VIR SALAIRE', normalizedDescription: 'salaire', monthlyAmount: 1000, currency: 'EUR',
  frequency: 'monthly', firstSeenDate: '2026-01-05', lastSeenDate: '2026-09-05', contractEndDate: null,
  endDateConfidence: 'none', category: 'salary', isActive: true, ...o,
});

const setData = (data: RecurringCredit[] | undefined, extra: Partial<typeof state.q> = {}) => {
  state.q = { isLoading: false, isError: false, isFetching: false, data, refetch: vi.fn(), ...extra };
};

describe('<IncomePage /> — revue UX L25', () => {
  beforeEach(() => setData([]));

  it('t1 — le sous-titre compte les actifs et les inactifs exclus du total', () => {
    setData([
      credit({ id: 'a', monthlyAmount: 500 }),
      credit({ id: 'b', description: 'VIR PRIME', monthlyAmount: 1500 }),
      credit({ id: 'c', description: 'VIR ANCIEN', monthlyAmount: 300, isActive: false, lastSeenDate: '2026-03-04' }),
    ]);
    render(<IncomePage />);
    expect(screen.getByText('2 revenus récurrents actifs · 1 inactif, exclu du total.')).toBeInTheDocument();
    expect(screen.getByText(/2[\s  ]000,00/)).toBeInTheDocument();
  });

  it('t1 — le sous-titre au singulier sans inactif ne mentionne pas d’inactifs', () => {
    setData([credit({})]);
    render(<IncomePage />);
    expect(screen.getByText('1 revenu récurrent actif.')).toBeInTheDocument();
  });

  it('t1 — les actifs sont triés par montant décroissant', () => {
    setData([credit({ id: 'a', description: 'PETIT', monthlyAmount: 100 }), credit({ id: 'b', description: 'GROS', monthlyAmount: 900 })]);
    render(<IncomePage />);
    const rows = screen.getAllByTestId('income-active-row');
    expect(rows[0]).toHaveTextContent('GROS');
    expect(rows[1]).toHaveTextContent('PETIT');
  });

  it('t1 — un inactif est dans la carte « Revenus terminés », badge « Inactif », dernier vu, pleine opacité', () => {
    setData([credit({ id: 'a' }), credit({ id: 'c', description: 'VIR ANCIEN', monthlyAmount: 300, isActive: false, lastSeenDate: '2026-03-04' })]);
    render(<IncomePage />);
    const ended = screen.getByRole('region', { name: 'Revenus terminés' });
    expect(within(ended).getByText('VIR ANCIEN')).toBeInTheDocument();
    expect(within(ended).getByText('Inactif')).toBeInTheDocument();
    expect(within(ended).getByText(/Dernier vu : 04\/03\/2026/)).toBeInTheDocument();
    expect(ended.innerHTML).not.toMatch(/opacity-50/);
    expect(within(ended).getByText(/300,00/).className).toContain('text-fg-muted');
    expect(within(ended).getByText(/300,00/).className).not.toContain('text-positive');
  });

  it('t1 — les inactifs sont triés par dernier vu décroissant, quel que soit l’ordre reçu', () => {
    setData([
      credit({ id: 'o', description: 'VIR VIEUX', monthlyAmount: 900, isActive: false, lastSeenDate: '2026-01-04' }),
      credit({ id: 'n', description: 'VIR RECENT', monthlyAmount: 100, isActive: false, lastSeenDate: '2026-08-04' }),
      credit({ id: 'm', description: 'VIR MILIEU', monthlyAmount: 500, isActive: false, lastSeenDate: '2026-04-04' }),
    ]);
    render(<IncomePage />);
    const ended = screen.getByRole('region', { name: 'Revenus terminés' });
    const text = ended.textContent ?? '';
    expect(text.indexOf('VIR RECENT')).toBeLessThan(text.indexOf('VIR MILIEU'));
    expect(text.indexOf('VIR MILIEU')).toBeLessThan(text.indexOf('VIR VIEUX'));
  });

  it('t1 — sans inactif, pas de carte « Revenus terminés »', () => {
    setData([credit({})]);
    render(<IncomePage />);
    expect(screen.queryByRole('region', { name: 'Revenus terminés' })).not.toBeInTheDocument();
  });

  it('t2 — une erreur de l’API affiche ErrorState avec Réessayer et masque le total', async () => {
    const refetch = vi.fn();
    setData(undefined, { isError: true, refetch });
    render(<IncomePage />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/\/ mois/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Importe au moins/)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: /Réessayer/ }));
    expect(refetch).toHaveBeenCalled();
  });

  it('t3 — la fiabilité de la date de fin est en français explicite', () => {
    setData([
      credit({ id: 'a', description: 'A', contractEndDate: '2027-01-01', endDateConfidence: 'high' }),
      credit({ id: 'b', description: 'B', contractEndDate: '2027-01-01', endDateConfidence: 'medium' }),
      credit({ id: 'c', description: 'C', contractEndDate: '2027-01-01', endDateConfidence: 'low' }),
    ]);
    render(<IncomePage />);
    expect(screen.getByText('Fiabilité élevée')).toBeInTheDocument();
    expect(screen.getByText('Fiabilité moyenne')).toBeInTheDocument();
    expect(screen.getByText('Fiabilité faible')).toBeInTheDocument();
    expect(screen.queryByText(/^(high|medium|low)$/)).not.toBeInTheDocument();
  });

  it('t4 — le libellé n’est plus tronqué (retour à la ligne) et chaque séparateur est rattaché à l’élément suivant', () => {
    setData([credit({ description: 'VIR LOYER LOCATAIRE DUPONT TRES LONG LIBELLE' })]);
    render(<IncomePage />);
    const label = screen.getByText('VIR LOYER LOCATAIRE DUPONT TRES LONG LIBELLE');
    expect(label.className).not.toContain('truncate');
    expect(label.className).toMatch(/break-words|line-clamp-2/);
    const meta = screen.getByText('Mensuel').parentElement as HTMLElement;
    // aucun « · » isolé : il est dans le même nœud que l’élément qu’il précède
    expect(Array.from(meta.children).some((n) => n.textContent === '·')).toBe(false);
    expect(screen.getByText('Mensuel').textContent).toContain('·');
  });

  it('t5 — l’état vide parle de revenus et propose « Importer un relevé » vers /upload', () => {
    setData([]);
    render(<IncomePage />);
    expect(screen.getByText('Aucun revenu récurrent détecté pour l’instant.')).toBeInTheDocument();
    expect(screen.queryByText(/crédit récurrent/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Importer un relevé' })).toHaveAttribute('href', '/upload');
  });
});
