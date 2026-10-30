import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AutoCategorizeModal } from './auto-categorize-modal';

const post = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn().mockResolvedValue({}), post: (...a: unknown[]) => post(...a), patch: vi.fn() },
}));

function suggestion(over: Record<string, unknown> = {}) {
  return {
    transactionId: 't1',
    description: 'CB VINCI AUTOROUTES',
    amount: -12.4,
    date: '2026-09-03',
    currentCategory: 'other',
    suggestedCategory: 'transport',
    confidence: 1,
    reasoning: 'Marchand reconnu : Vinci',
    proposedRulePattern: '\\bVINCI\\b',
    source: 'dictionary',
    ...over,
  };
}

async function open(s: Record<string, unknown>) {
  post.mockImplementation((url?: string) =>
    String(url).includes('/preview')
      ? Promise.resolve({
          statementId: 's1', totalOther: 1, processed: 1, warnings: [],
          availableCategories: ['transport', 'housing', 'food'],
          suggestions: [s],
        })
      : Promise.resolve({ statementId: 's1', applied: 1, rulesCreated: 0, replayed: 0 }),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AutoCategorizeModal statementId="s1" onClose={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /Lancer l'analyse/ }));
  await screen.findByRole('combobox');
}

const ruleBox = () => screen.queryByRole('checkbox', { name: /Créer la règle/ }) as HTMLInputElement | null;
const select = () => screen.getByRole('combobox') as HTMLSelectElement;

async function apply() {
  fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
  await waitFor(() => expect(post.mock.calls.some((c) => String(c[0]).includes('/apply'))).toBe(true));
  return post.mock.calls.find((c) => String(c[0]).includes('/apply'))![1];
}

describe('motif proposé et catégorie choisie (L77)', () => {
  beforeEach(() => post.mockReset());

  it('R1 — suggestion du dictionnaire inchangée : règle pré-cochée avec son motif', async () => {
    await open(suggestion());
    expect(ruleBox()!.checked).toBe(true);
    const body = await apply();
    expect(body.decisions[0]).toMatchObject({ category: 'transport', rulePattern: '\\bVINCI\\b' });
  });

  it('R2 — changer la catégorie contre le dictionnaire (Vinci → Logement) retire la règle', async () => {
    await open(suggestion());
    fireEvent.change(select(), { target: { value: 'housing' } });
    expect(ruleBox()).toBeNull();
    expect(screen.getByText(/contredit le marchand reconnu/)).toBeTruthy();
    const body = await apply();
    expect(body.decisions[0].category).toBe('housing');
    expect(body.decisions[0].rulePattern).toBeUndefined();
    expect(body.decisions[0].replayAll).toBe(false);
  });

  it('R3 — revenir à la catégorie du dictionnaire rend la règle pré-cochée', async () => {
    await open(suggestion());
    fireEvent.change(select(), { target: { value: 'housing' } });
    fireEvent.change(select(), { target: { value: 'transport' } });
    expect(ruleBox()!.checked).toBe(true);
    expect(screen.queryByText(/contredit le marchand reconnu/)).toBeNull();
  });

  it('R4 — « Rejouer sur l\'historique » ne survit pas au retrait de la règle', async () => {
    await open(suggestion());
    fireEvent.click(screen.getByRole('checkbox', { name: /Rejouer/ }));
    fireEvent.change(select(), { target: { value: 'housing' } });
    fireEvent.change(select(), { target: { value: 'transport' } });
    expect((screen.getByRole('checkbox', { name: /Rejouer/ }) as HTMLInputElement).checked).toBe(false);
  });

  it('R5 — une suggestion de Claude garde sa règle quand on change la catégorie', async () => {
    await open(suggestion({ source: 'claude', confidence: 0.9, proposedRulePattern: 'LIDL' }));
    fireEvent.change(select(), { target: { value: 'food' } });
    expect(ruleBox()!.checked).toBe(true);
  });
});
