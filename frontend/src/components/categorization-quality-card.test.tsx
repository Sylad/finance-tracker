import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CategorizationQualityCard } from './categorization-quality-card';
import type { Transaction } from '@/types/api';

let n = 0;
const tx = (description: string, amount: number, category: Transaction['category'] = 'other'): Transaction => ({
  id: `t${n++}`, date: '2026-09-10', description, normalizedDescription: description, amount,
  currency: 'EUR', category, subcategory: '', isRecurring: false, confidence: 0.9,
});

describe('<CategorizationQualityCard /> (L74)', () => {
  it('affiche le taux en pourcentage, le décompte et les marchands à classer', () => {
    render(
      <CategorizationQualityCard
        transactions={[tx('CB TABAC LA GARE 03/09', -30), tx('CB TABAC LA GARE 04/09', -5), tx('CB LIDL', -20, 'food'), tx('CB SNCF', -9, 'transport')]}
      />,
    );
    expect(screen.getByText('50 %')).toBeInTheDocument();
    expect(screen.getByText(/2 transactions sur 4/)).toBeInTheDocument();
    expect(screen.getByText('TABAC LA GARE')).toBeInTheDocument();
    expect(screen.getByText(/2 fois/)).toBeInTheDocument();
  });

  it('tout est catégorisé : message positif, pas de liste', () => {
    render(<CategorizationQualityCard transactions={[tx('CB LIDL', -20, 'food')]} />);
    expect(screen.getByText('0 %')).toBeInTheDocument();
    expect(screen.getByText(/Toutes les transactions sont classées/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('sans transaction : ne rend rien', () => {
    const { container } = render(<CategorizationQualityCard transactions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
