import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ClassicCard } from './classic-card';
import { RevolvingCard } from './revolving-card';
import { InstallmentCard } from './installment-card';
import { ClosedCard } from './closed-card';
import { LoanForm } from './loan-form';
import type { Loan, LoanInput } from '@/types/api';

const idle = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
vi.mock('@/lib/queries', () => ({
  useResyncLoan: () => idle,
  useResetRevolving: () => idle,
  useSplitLoanByAmount: () => idle,
}));

const loan = (over: Partial<Loan>): Loan => ({
  id: 'l1', name: 'Cofidis voiture', creditor: 'Cofidis', type: 'classic', category: 'consumer',
  monthlyPayment: 100, occurrencesDetected: [], isActive: true, ...over,
} as unknown as Loan);

const CARDS = [
  ['ClassicCard', ClassicCard, loan({ kind: 'classic' })],
  ['RevolvingCard', RevolvingCard, loan({ kind: 'revolving', type: 'revolving' })],
  ['InstallmentCard', InstallmentCard, loan({ kind: 'installment', installmentSchedule: [] })],
  ['ClosedCard', ClosedCard, loan({ isActive: false })],
] as const;

describe('Cartes de crédit — boutons icône nommés (L132, WCAG 4.1.2)', () => {
  it.each(CARDS)('R1 — %s : « Modifier <nom> » porte aria-label et title', (_n, Card, l) => {
    const onEdit = vi.fn();
    render(<Card loan={l} onEdit={onEdit} onDelete={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'Modifier Cofidis voiture' });
    expect(btn).toHaveAttribute('title', 'Modifier Cofidis voiture');
    fireEvent.click(btn);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it.each(CARDS)('R2 — %s : « Supprimer <nom> » porte aria-label et title', (_n, Card, l) => {
    const onDelete = vi.fn();
    render(<Card loan={l} onEdit={vi.fn()} onDelete={onDelete} />);
    const btn = screen.getByRole('button', { name: 'Supprimer Cofidis voiture' });
    expect(btn).toHaveAttribute('title', 'Supprimer Cofidis voiture');
    fireEvent.click(btn);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

describe('<LoanForm /> — croix de fermeture nommée (L132, WCAG 4.1.2)', () => {
  it('R3 — le × est « Fermer » (aria-label et title) et ferme le formulaire', () => {
    const onCancel = vi.fn();
    render(<LoanForm init={{ name: '' } as LoanInput} onSave={vi.fn()} onCancel={onCancel} busy={false} />);
    const btn = screen.getByRole('button', { name: 'Fermer' });
    expect(btn).toHaveAttribute('title', 'Fermer');
    fireEvent.click(btn);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
