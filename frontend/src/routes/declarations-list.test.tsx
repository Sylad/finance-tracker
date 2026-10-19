import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeclarationRow } from './declarations';
import type { Declaration } from '@/types/api';

const decl: Declaration = {
  id: 'd1',
  type: 'expense',
  label: 'Assurance habitation multirisque — contrat famille Dupont-Martin',
  amount: 42.5,
  periodicity: 'monthly',
  startDate: '2026-01-05',
  endDate: '2026-12-31',
  category: 'insurance',
  notes: '',
  matchPattern: '',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

function renderRow() {
  render(<DeclarationRow d={decl} onEdit={() => {}} onDelete={() => {}} />);
  const label = screen.getByText(decl.label);
  const row = label.closest('[data-testid="declaration-row"]') as HTMLElement;
  return { label, row, details: screen.getByTestId('declaration-details'), amount: screen.getByTestId('declaration-amount'), actions: screen.getByTestId('declaration-actions') };
}

describe('Déclarations — liste au téléphone (L86)', () => {
  it('R1 — le libellé n\'est jamais tronqué : il passe à la ligne', () => {
    const { label } = renderRow();
    expect(label.className).not.toContain('truncate');
    expect(label.className).toContain('break-words');
  });

  it('R2 — sous 640 px la ligne est une grille à deux rangées, à plat à partir de sm', () => {
    const { row } = renderRow();
    expect(row.className).toContain('grid');
    expect(row.className).toContain('sm:flex');
  });

  it('R3 — rangée 1 : badge + libellé ; rangée 2 : détails à gauche, montant et actions à droite', () => {
    const { label, details, amount, actions } = renderRow();
    expect(label.className).toContain('col-span-3');
    expect(details.className).toContain('col-span-2');
    expect(details.className).toContain('row-start-2');
    expect(amount.className).toContain('row-start-2');
    expect(actions.className).toContain('row-start-2');
  });

  it('R4 — les détails ne passent pas sous le montant : colonne propre qui rétrécit, montant fixe', () => {
    const { details, amount } = renderRow();
    expect(details.className).toContain('min-w-0');
    expect(amount.className).toContain('shrink-0');
    expect(amount.className).toContain('whitespace-nowrap');
  });

  it('R5 — le contenu (libellé, détails, montant) reste affiché en entier', () => {
    const { details, amount } = renderRow();
    expect(details.textContent).toContain('Jusqu\'à');
    expect(amount.textContent).toContain('42,50');
  });
});
