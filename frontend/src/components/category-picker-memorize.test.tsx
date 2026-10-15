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

function setup(over: Record<string, unknown> = {}) {
  const tx = { id: 't1', description: 'CB CARREFOUR 12/03', normalizedDescription: 'CB CARREFOUR MARKET', category: 'other', subcategory: '', ...over } as unknown as Transaction;
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

describe('choix de règle du sélecteur (L75, R16)', () => {
  beforeEach(() => patch.mockClear());

  it('R16 — par défaut, envoie memorizeMerchant sans createRule (createRule l\'emporterait seul)', async () => {
    setup();
    expect((screen.getByRole('radio', { name: /Mémoriser pour/ }) as HTMLInputElement).checked).toBe(true);
    await save();
    await waitFor(() => expect(patch).toHaveBeenCalled());
    const body = patch.mock.calls[0][1];
    expect(body.memorizeMerchant).toBe(true);
    expect(body.createRule).toBe(false);
    expect(body.rulePattern).toBeUndefined();
  });

  it('R16 — le choix « motif » envoie createRule sans memorizeMerchant (une seule règle)', async () => {
    setup();
    fireEvent.click(screen.getByRole('radio', { name: /Règle avec un motif/ }));
    await save();
    await waitFor(() => expect(patch).toHaveBeenCalled());
    const body = patch.mock.calls[0][1];
    expect(body.memorizeMerchant).toBe(false);
    expect(body.createRule).toBe(true);
  });

  it('R16 — « Aucune règle » n\'envoie ni createRule ni memorizeMerchant', async () => {
    setup();
    fireEvent.click(screen.getByRole('radio', { name: /Aucune règle/ }));
    await save();
    await waitFor(() => expect(patch).toHaveBeenCalled());
    const body = patch.mock.calls[0][1];
    expect(body.memorizeMerchant).toBe(false);
    expect(body.createRule).toBe(false);
  });

  it('R15 — le choix nomme la clé du marchand (CB AMAZON.FR → « AMAZON FR »)', () => {
    setup({ description: 'CB AMAZON.FR', normalizedDescription: 'CB AMAZON.FR' });
    expect(screen.getByRole('radio', { name: /Mémoriser pour « AMAZON FR »/ })).toBeTruthy();
  });

  it('R14 — clé vide : mémorisation désactivée avec la raison, aucune règle envoyée', async () => {
    setup({ description: 'CB 1234', normalizedDescription: 'CB 1234' });
    const radio = screen.getByRole('radio', { name: /Mémoriser pour/ }) as HTMLInputElement;
    expect(radio.disabled).toBe(true);
    expect(screen.getByText(/Aucun nom de marchand reconnu dans ce libellé/)).toBeTruthy();
    await save();
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0][1].memorizeMerchant).toBe(false);
  });
});

describe('accessibilité du dialogue Catégoriser (L75)', () => {
  it('expose role=dialog, aria-modal, un nom, un bouton Fermer nommé et le focus sur la première catégorie', () => {
    setup();
    const dlg = screen.getByRole('dialog', { name: 'Catégoriser' });
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('button', { name: 'Fermer' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getAllByRole('button', { name: /Revenus|Logement/ })[0]);
  });

  it('le dialogue défile sur petit écran (voile et carte bornés en hauteur)', () => {
    setup();
    const dlg = screen.getByRole('dialog');
    expect(dlg.className).toMatch(/overflow-y-auto/);
    expect(dlg.className).toMatch(/max-h-/);
    expect(dlg.parentElement!.className).toMatch(/overflow-y-auto/);
  });
});
