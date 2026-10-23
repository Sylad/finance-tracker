import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InstallmentCard } from './installment-card';
import type { Loan } from '@/types/api';

vi.mock('./health-chip', () => ({ HealthChip: () => null }));

const loan = {
  id: 'n1', name: 'Cofidis 3X', creditor: 'Cofidis', kind: 'installment', type: 'classic',
  category: 'consumer', monthlyPayment: 50, isActive: true,
  installmentSignatureDate: '2026-03-05',
  installmentSchedule: [
    { dueDate: '2026-03-05', amount: 50, paid: true },
    { dueDate: '2026-04-05', amount: 50, paid: false },
  ],
} as unknown as Loan;

describe('Crédits, carte N× — dates en français (L141)', () => {
  it('R1 — « signé » écrit la date au format jj/mm/aaaa', () => {
    render(<InstallmentCard loan={loan} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('· signé 05/03/2026')).toBeInTheDocument();
    expect(screen.queryByText(/signé 2026-/)).toBeNull();
  });

  it('R2 — la liste des échéances écrit « 1. 05/03/2026 » au format jj/mm/aaaa', () => {
    render(<InstallmentCard loan={loan} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('1. 05/03/2026')).toBeInTheDocument();
    expect(screen.getByText('2. 05/04/2026')).toBeInTheDocument();
    expect(screen.queryByText(/\b2026-\d\d-\d\d\b/)).toBeNull();
  });

  it('R3 — l’infobulle de chaque pastille écrit l’échéance au format jj/mm/aaaa', () => {
    const { container } = render(<InstallmentCard loan={loan} onEdit={vi.fn()} onDelete={vi.fn()} />);
    const titles = Array.from(container.querySelectorAll('[title^="Échéance"]')).map((e) => e.getAttribute('title'));
    expect(titles).toHaveLength(2);
    expect(titles[0]).toContain('1/2 : 05/03/2026');
    expect(titles[1]).toContain('2/2 : 05/04/2026');
    titles.forEach((t) => expect(t).not.toMatch(/\d{4}-\d{2}-\d{2}/));
  });
});
