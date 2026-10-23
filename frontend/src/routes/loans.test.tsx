import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoansPage } from './loans';

const state = vi.hoisted(() => ({ loans: [] as unknown[], suggestions: [] as unknown[] }));

const idle = { mutateAsync: vi.fn(), isPending: false };

vi.mock('@/lib/queries', () => ({
  useLoans: () => ({ data: state.loans, isLoading: false }),
  useCreateLoan: () => idle,
  useUpdateLoan: () => idle,
  useDeleteLoan: () => idle,
  useAcceptSuggestion: () => idle,
  useResetLoans: () => idle,
  useDetectionScan: () => idle,
  useLoanSuggestions: () => ({ data: state.suggestions }),
}));
vi.mock('@/components/loans/suggestions-banner', () => ({ SuggestionsBanner: () => null }));
vi.mock('@/components/loans/classic-card', () => ({ ClassicCard: () => null }));
vi.mock('@/components/loans/revolving-card', () => ({ RevolvingCard: () => null }));
vi.mock('@/components/loans/closed-card', () => ({ ClosedCard: () => null }));
vi.mock('@/components/loans/installment-card', () => ({ InstallmentCard: () => null }));
vi.mock('@/components/loans/loans-monthly-chart', () => ({ LoansMonthlyChart: () => null }));

const LABELS = [
  /Importer PDF crédits/,
  /Détecter les crédits/,
  /Doublons/,
  /Suspects/,
  /Reset/,
  /Nouveau crédit/,
];

describe('<LoansPage /> — en-tête à toute largeur (L96)', () => {
  it('R1 — les six actions de l\'en-tête restent toutes présentes', () => {
    render(<LoansPage />);
    for (const label of LABELS) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('R2 — la rangée d\'actions passe à la ligne au lieu d\'élargir la page', () => {
    render(<LoansPage />);
    const row = screen.getByRole('button', { name: /Nouveau crédit/ }).parentElement as HTMLElement;
    expect(row.className).toContain('flex-wrap');
    expect(row.className).not.toContain('flex-nowrap');
    for (const label of LABELS) {
      expect(screen.getByRole('button', { name: label }).parentElement).toBe(row);
    }
  });

  it('R3 — dès 640 px le titre et les actions sont empilés, jamais côte à côte', () => {
    render(<LoansPage />);
    const header = screen.getByRole('heading', { level: 1 }).closest('header') as HTMLElement;
    expect(header.className).toContain('sm:flex-col');
    expect(header.className).not.toContain('sm:flex-row');
    expect(header.className).not.toMatch(/(^|\s)(md|lg|xl|2xl):flex-row/);
  });
});

describe('<LoansPage /> — sous-titre (L140)', () => {
  const loan = (id: string, isActive: boolean) => ({ id, name: id, type: 'classic', monthlyPayment: 100, isActive });
  const subtitle = (loans: unknown[]) => {
    state.loans = loans;
    const { container, unmount } = render(<LoansPage />);
    const text = container.querySelector('header')?.textContent ?? '';
    unmount();
    return text;
  };

  it('R1 — 1 actif + 1 terminé : « 1 crédit actif », au singulier', () => {
    const text = subtitle([loan('a', true), loan('b', false)]);
    expect(text).toContain('1 crédit actif');
    expect(text).not.toContain('crédits actifs');
  });

  it('R2 — le pluriel suit le nombre d\'actifs, pas le total', () => {
    expect(subtitle([loan('a', true), loan('b', true), loan('c', false)])).toContain('2 crédits actifs');
  });

  it('R3 — aucun actif parmi des crédits terminés : « 0 crédit actif »', () => {
    expect(subtitle([loan('a', false), loan('b', false)])).toContain('0 crédit actif');
  });
});

describe('<LoansPage /> — suggestion en attente signalée en haut (L139)', () => {
  it('R6 — le signal est dans l\'en-tête de page, avant les graphiques et les cartes', () => {
    state.loans = [{ id: 'a', name: 'a', type: 'classic', monthlyPayment: 100, isActive: true }];
    state.suggestions = [{ id: 's', label: 's', status: 'pending', suggestedType: 'loan' }];
    const { container } = render(<LoansPage />);
    const header = container.querySelector('header') as HTMLElement;
    const signal = screen.getByRole('button', { name: /1 suggestion à valider/ });
    expect(header.compareDocumentPosition(signal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const firstSection = container.querySelector('section') as HTMLElement;
    expect(signal.compareDocumentPosition(firstSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    state.suggestions = [];
  });

  it('R7 — sans suggestion en attente, la page n\'affiche aucun signal', () => {
    state.suggestions = [];
    render(<LoansPage />);
    expect(screen.queryByText(/à valider/)).toBeNull();
  });
});
