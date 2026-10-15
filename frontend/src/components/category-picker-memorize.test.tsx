import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CategoryPicker } from './category-picker';
import type { Transaction } from '@/types/api';

const patch = vi.fn().mockResolvedValue({});
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ rules: [], userCategories: [], availableCategories: [] }),
    post: vi.fn(),
    patch: (...a: unknown[]) => patch(...a),
  },
}));

function setup() {
  const tx = { id: 't1', description: 'CB CARREFOUR 12/03', normalizedDescription: 'CB CARREFOUR', category: 'other', subcategory: '' } as unknown as Transaction;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CategoryPicker statementId="s1" tx={tx} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

async function save() {
  const btn = screen.getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement;
  await waitFor(() => expect(btn.disabled).toBe(false));
  fireEvent.click(btn);
}

describe('case « Mémoriser pour ce marchand » (L75, R16)', () => {
  beforeEach(() => patch.mockClear());

  it('R16 — cochée, envoie memorizeMerchant sans createRule (createRule l\'emporterait seul)', async () => {
    setup();
    const box = screen.getByRole('checkbox', { name: /Mémoriser pour ce marchand/ });
    expect((box as HTMLInputElement).checked).toBe(true);
    await save();
    await waitFor(() => expect(patch).toHaveBeenCalled());
    const body = patch.mock.calls[0][1];
    expect(body.memorizeMerchant).toBe(true);
    expect(body.createRule).toBe(false);
    expect(body.rulePattern).toBeUndefined();
  });

  it('R16 — cocher « transactions futures similaires » décoche la mémorisation (une seule règle)', async () => {
    setup();
    fireEvent.click(screen.getByRole('checkbox', { name: /transactions futures similaires/ }));
    expect((screen.getByRole('checkbox', { name: /Mémoriser pour ce marchand/ }) as HTMLInputElement).checked).toBe(false);
    await save();
    await waitFor(() => expect(patch).toHaveBeenCalled());
    const body = patch.mock.calls[0][1];
    expect(body.memorizeMerchant).toBe(false);
    expect(body.createRule).toBe(true);
  });
});
