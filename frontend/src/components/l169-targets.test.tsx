// L169 — cibles d'au moins 24 px (WCAG 2.5.8) : chaque lien ou bouton que la revue a agrandi
// porte min-h-6 (1,5 rem = 24 px). jsdom ne calcule pas de mise en page : on vérifie la classe
// Tailwind qui donne la hauteur, comme les autres tests de mise en page du dépôt.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BudgetSnapshot } from './dashboard/budget-snapshot';
import { RecentStatements } from './dashboard/recent-statements';
import { HealthChip } from './loans/health-chip';
import { TxRow } from './tx-row';
import type { Loan, Transaction } from '@/types/api';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className }: { children: React.ReactNode; className?: string }) => <a href="#" className={className}>{children}</a>,
}));

const MIN_24 = /(^| )min-h-6( |$)/;
const idle = { isPending: false, isError: false };

describe('Cibles ≥ 24 px (L169, WCAG 2.5.8)', () => {
  it('tableau de bord — « Configurer » des budgets', () => {
    render(<BudgetSnapshot budget={{}} transactions={[]} budgetQ={idle} txQ={idle} />);
    expect(screen.getByRole('link', { name: /Configurer/ }).className).toMatch(MIN_24);
  });

  it('tableau de bord — « Voir tout » des relevés récents', () => {
    render(<RecentStatements summaries={[]} />);
    expect(screen.getByRole('link', { name: /Voir tout/ }).className).toMatch(MIN_24);
  });

  it('crédits — la pastille de santé, en bouton (Partiel) comme en simple étiquette (Complet)', () => {
    const loan = (health: string) => ({
      id: 'l1', name: 'Crédit démo', creditor: 'Démo', type: 'classic', category: 'consumer',
      monthlyPayment: 100, occurrencesDetected: [], isActive: true, kind: 'classic', health,
    } as unknown as Loan);
    const { unmount } = render(<HealthChip now="2026-10-23" loan={loan('partial')} />);
    expect(screen.getByRole('button', { name: /Partiel/ }).className).toMatch(MIN_24);
    unmount();
    const { container } = render(<HealthChip now="2026-10-23" loan={loan('complete')} />);
    expect((container.firstElementChild as HTMLElement).className).toMatch(MIN_24);
  });

  it('relevé — le badge de catégorie d’une transaction', () => {
    const t = {
      id: 't1', date: '2025-09-02', description: 'PRELEVEMENT DEMO', normalizedDescription: 'DEMO',
      amount: -12.5, category: 'other', subcategory: 'other', isRecurring: false,
    } as unknown as Transaction;
    render(<TxRow t={t} onPickCategory={() => {}} />);
    expect(screen.getByTitle('Modifier la catégorie').className).toMatch(MIN_24);
  });
});
