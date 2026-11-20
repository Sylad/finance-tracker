import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DedupeModal } from './dedupe-modal';

vi.mock('@/lib/queries', () => {
  const loan = (id: string, createdAt: string) => ({
    id,
    name: `COFIDIS ${id}`,
    monthlyPayment: 120,
    occurrencesCount: 6,
    isActive: true,
    createdAt,
  });
  return {
    useLoanDuplicates: () => ({
      data: [
        {
          creditor: 'COFIDIS',
          type: 'classic',
          reasons: ['Même mensualité'],
          loans: [loan('a', '2026-07-08T10:00:00.000Z'), loan('b', '2026-03-15T10:00:00.000Z')],
        },
      ],
      isLoading: false,
      refetch: vi.fn(),
    }),
    useMergeLoanDuplicates: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

describe('L182 — date de création des doublons', () => {
  it('s’écrit en jour comme le reste de /loans (jj/mm/aaaa), jamais en mois abrégé', () => {
    render(<DedupeModal onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    const texte = dialog.textContent ?? '';
    expect(texte).toContain('créé 08/07/2026');
    expect(texte).toContain('créé 15/03/2026');
    expect(texte).not.toMatch(/créé \d{2} [a-zéû]+\.? \d{2}/i);
  });
});
