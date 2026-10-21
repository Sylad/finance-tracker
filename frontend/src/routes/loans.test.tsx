import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoansPage } from './loans';

const idle = { mutateAsync: vi.fn(), isPending: false };

vi.mock('@/lib/queries', () => ({
  useLoans: () => ({ data: [], isLoading: false }),
  useCreateLoan: () => idle,
  useUpdateLoan: () => idle,
  useDeleteLoan: () => idle,
  useAcceptSuggestion: () => idle,
  useResetLoans: () => idle,
  useDetectionScan: () => idle,
}));
vi.mock('@/components/loans/suggestions-banner', () => ({ SuggestionsBanner: () => null }));
vi.mock('@/components/loans/loans-monthly-chart', () => ({ LoansMonthlyChart: () => null }));

const LABELS = [
  /Importer PDF crédits/,
  /Détecter les crédits/,
  /Doublons/,
  /Suspects/,
  /Reset/,
  /Nouveau crédit/,
];

describe('<LoansPage /> — en-tête à 390 px (L96)', () => {
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
});
