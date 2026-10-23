import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HealthChip } from './health-chip';
import type { Loan } from '@/types/api';

const NOW = '2026-10-23';
const loan = (over: Partial<Loan>): Loan => ({
  id: 'l1', name: 'Cofidis voiture', creditor: 'Cofidis', type: 'classic', category: 'consumer',
  monthlyPayment: 100, occurrencesDetected: [], isActive: true, kind: 'classic', ...over,
} as unknown as Loan);
const occ = (...dates: string[]) => dates.map((date) => ({ date, amount: -100 })) as unknown as Loan['occurrencesDetected'];

describe('Crédits — la puce de santé dit ce qui manque (L138)', () => {
  it('R1 — la puce « Partiel » est un bouton focalisable, replié au départ', () => {
    render(<HealthChip now={NOW} loan={loan({ health: 'partial', occurrencesDetected: occ('2026-10-01', '2026-09-01', '2026-08-01') })} />);
    const btn = screen.getByRole('button', { name: /Partiel/ });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(btn.tabIndex).toBeGreaterThanOrEqual(0);
    expect(screen.queryByText(/Il manque/)).toBeNull();
  });

  it('R2 — ouverte, elle nomme le critère manquant (données) et celui qui est tenu (prélèvements)', () => {
    render(<HealthChip now={NOW} loan={loan({ health: 'partial', occurrencesDetected: occ('2026-10-01', '2026-09-01', '2026-08-01') })} />);
    const btn = screen.getByRole('button', { name: /Partiel/ });
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/Manque : un tableau d'amortissement ou un relevé crédit de moins de 60 jours/)).toBeInTheDocument();
    expect(screen.getByText(/Tenu : au moins 3 prélèvements sur les 180 derniers jours \(3 trouvés\)/)).toBeInTheDocument();
    expect(screen.getByText(/Importez un relevé crédit/)).toBeInTheDocument();
  });

  it('R3 — un relevé trop ancien est nommé comme tel, pas comme absent', () => {
    const l = loan({
      health: 'partial',
      occurrencesDetected: occ('2026-10-01', '2026-09-01', '2026-08-01'),
      lastStatementSnapshot: { date: '2026-05-01', source: 'pdf-import', extractedValues: { statementDate: '2026-05-01' } },
    });
    render(<HealthChip now={NOW} loan={l} />);
    fireEvent.click(screen.getByRole('button', { name: /Partiel/ }));
    expect(screen.getByText(/dernier relevé crédit date du 01\/05\/2026/)).toBeInTheDocument();
  });

  it('R4 — prélèvements en nombre insuffisant : le décompte est affiché', () => {
    const l = loan({
      health: 'partial',
      amortizationSchedule: [{ month: '2026-11' }] as unknown as Loan['amortizationSchedule'],
      occurrencesDetected: occ('2026-10-01'),
    });
    render(<HealthChip now={NOW} loan={l} />);
    fireEvent.click(screen.getByRole('button', { name: /Partiel/ }));
    expect(screen.getByText(/Manque : au moins 3 prélèvements sur les 180 derniers jours \(1 trouvé\)/)).toBeInTheDocument();
    expect(screen.getByText(/Tenu : un tableau d'amortissement/)).toBeInTheDocument();
  });

  it('R5 — paiement en N fois : les échéances échues non retrouvées sont comptées', () => {
    const l = loan({
      kind: 'installment', health: 'partial',
      installmentSchedule: [
        { dueDate: '2026-08-01', amount: 50, paid: true },
        { dueDate: '2026-09-01', amount: 50, paid: false },
        { dueDate: '2026-10-01', amount: 50, paid: false },
        { dueDate: '2026-11-01', amount: 50, paid: false },
      ],
    });
    render(<HealthChip now={NOW} loan={l} />);
    fireEvent.click(screen.getByRole('button', { name: /Partiel/ }));
    expect(screen.getByText(/Manque : 2 échéances échues sur 3 non retrouvées dans les relevés bancaires/)).toBeInTheDocument();
    expect(screen.getByText(/Importez le relevé bancaire/)).toBeInTheDocument();
  });

  it('R1 — paiement en N fois : l\'échéance du jour n\'est pas comptée échue (même borne que la carte)', () => {
    const l = loan({
      kind: 'installment', health: 'partial',
      installmentSchedule: [
        { dueDate: '2026-09-23', amount: 62.5, paid: true },
        { dueDate: NOW, amount: 62.5, paid: false },
      ],
    });
    render(<HealthChip now={NOW} loan={l} />);
    fireEvent.click(screen.getByRole('button', { name: /Partiel/ }));
    expect(screen.getByText(/Tenu : 0 échéance échue sur 1 non retrouvée/)).toBeInTheDocument();
  });

  it('R6 —« Trou » est aussi une divulgation ; « Complet » reste une simple étiquette', () => {
    const { unmount } = render(<HealthChip now={NOW} loan={loan({ health: 'gap' })} />);
    fireEvent.click(screen.getByRole('button', { name: /Trou/ }));
    expect(screen.getByText(/Manque : un tableau d'amortissement ou un relevé crédit/)).toBeInTheDocument();
    unmount();
    render(<HealthChip now={NOW} loan={loan({ health: 'complete' })} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Complet')).toBeInTheDocument();
  });

  it('R7 — la fenêtre est nommée et le total de la carte est rappelé quand il diffère', () => {
    const l = loan({
      health: 'partial',
      occurrencesDetected: occ('2026-10-01', '2026-09-01', '2026-08-01', '2026-07-01', '2026-06-01', '2026-03-01'),
    });
    render(<HealthChip now={NOW} loan={l} />);
    fireEvent.click(screen.getByRole('button', { name: /Partiel/ }));
    expect(screen.getByText(/5 trouvés\) — la carte compte 6 mensualités prélevées depuis le début/)).toBeInTheDocument();
  });

  it('R7 — sans écart avec la carte, aucun rappel de total', () => {
    render(<HealthChip now={NOW} loan={loan({ health: 'partial', occurrencesDetected: occ('2026-10-01', '2026-09-01', '2026-08-01') })} />);
    fireEvent.click(screen.getByRole('button', { name: /Partiel/ }));
    expect(screen.queryByText(/la carte compte/)).toBeNull();
  });
});
