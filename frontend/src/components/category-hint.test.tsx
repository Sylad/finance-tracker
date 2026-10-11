import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CategoryPicker } from './category-picker';
import { DeclarationForm } from '@/routes/declarations';
import type { Transaction } from '@/types/api';

describe("libellé « Affichée : … » (L68)", () => {
  it('declarations : relié au champ Catégorie par aria-describedby, hors du nom accessible', () => {
    render(
      <DeclarationForm
        init={{ label: 'EDF', type: 'recurring', amount: -50, category: 'utilities', periodicity: 'monthly', startDate: null, endDate: null } as never}
        onSave={() => {}}
        onCancel={() => {}}
        busy={false}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Catégorie' });
    const hint = screen.getByText(/Affichée : Énergie \/ eau/);
    expect(input.getAttribute('aria-describedby')).toBe(hint.id);
    expect(hint.id).not.toBe('');
  });

  it('sélecteur : relié au champ Sous-catégorie par aria-describedby', () => {
    const qc = new QueryClient();
    const tx = { id: 't1', description: 'X', normalizedDescription: 'X', category: 'other', subcategory: 'utilities' } as unknown as Transaction;
    render(
      <QueryClientProvider client={qc}>
        <CategoryPicker statementId="s1" tx={tx} onClose={() => {}} />
      </QueryClientProvider>,
    );
    const input = screen.getByRole('textbox', { name: /Sous-catégorie/ });
    const hint = screen.getByText(/Affichée : Énergie \/ eau/);
    expect(input.getAttribute('aria-describedby')).toBe(hint.id);
    expect(hint.id).not.toBe('');
  });
});
