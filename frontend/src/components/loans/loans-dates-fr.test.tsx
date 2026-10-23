import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClosedCard } from './closed-card';
import { SuspiciousModal } from './suspicious-modal';
import type { Loan } from '@/types/api';

const idle = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
vi.mock('@/lib/queries', () => ({
  useResyncLoan: () => idle,
  useResetRevolving: () => idle,
  useSplitLoanByAmount: () => idle,
  useCleanupSuspiciousLoans: () => idle,
  useConvertToInstallment: () => idle,
  useSuspiciousLoans: () => ({
    isLoading: false,
    refetch: vi.fn(),
    data: [{
      id: 's1', name: 'Cofidis voiture', creditor: 'Cofidis', monthlyPayment: 100,
      occurrencesCount: 3, lastOccurrenceDate: '2026-06-15', reason: 'Absent du dernier relevé',
    }],
  }),
}));

describe('Crédits — dates en français (L137)', () => {
  it('R1 — la carte terminée écrit « Dernière mensualité » au format jj/mm/aaaa', () => {
    const loan = {
      id: 'l1', name: 'Cofidis voiture', creditor: 'Cofidis', type: 'classic', category: 'consumer',
      monthlyPayment: 100, isActive: false,
      occurrencesDetected: [
        { date: '2026-05-15', amount: -100 },
        { date: '2026-06-15', amount: -100 },
      ],
    } as unknown as Loan;
    render(<ClosedCard loan={loan} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Dernière mensualité : 15/06/2026')).toBeInTheDocument();
    expect(screen.queryByText(/2026-06-15/)).toBeNull();
  });

  it('R2 — la modale Suspects écrit « dernière » au format jj/mm/aaaa', () => {
    render(<SuspiciousModal onClose={vi.fn()} />);
    expect(screen.getByText('· dernière 15/06/2026')).toBeInTheDocument();
    expect(screen.queryByText(/2026-06-15/)).toBeNull();
  });
});
