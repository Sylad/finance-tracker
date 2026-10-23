import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RevolvingCard } from './revolving-card';
import type { Loan } from '@/types/api';

const idle = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
vi.mock('@/lib/queries', () => ({
  useResyncLoan: () => idle,
  useResetRevolving: () => idle,
  useSplitLoanByAmount: () => idle,
}));

const debit = (date: string, over: object = {}) => ({ date, amount: -100, ...over });
const revolving = (occurrencesDetected: unknown[]): Loan => ({
  id: 'r1', name: 'COFIDIS …1100', creditor: 'Cofidis', type: 'revolving', kind: 'revolving', category: 'consumer',
  monthlyPayment: 100, maxAmount: 3000, usedAmount: 1000, occurrencesDetected, isActive: true,
} as unknown as Loan);

describe('Crédits — la carte revolving montre le compte que la puce cite (L145)', () => {
  it('R1 — la carte revolving affiche « N mensualités prélevées » (le compte de la puce Partiel)', () => {
    const l = revolving(['2026-03-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'].map((d) => debit(d)));
    render(<RevolvingCard loan={l} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('6 mensualités prélevées')).toBeInTheDocument();
  });

  it('R2 — le compte exclut tirages et remboursements anticipés, singulier à 1', () => {
    const l = revolving([debit('2026-10-01'), { date: '2026-09-01', amount: 500 }, debit('2026-08-01', { source: 'early_repayment' })]);
    render(<RevolvingCard loan={l} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('1 mensualité prélevée')).toBeInTheDocument();
  });

  it('R3 — sans prélèvement, la carte ne prétend aucun compte', () => {
    render(<RevolvingCard loan={revolving([])} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByText(/prélevée/)).toBeNull();
  });
});
