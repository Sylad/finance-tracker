import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExpensesPage } from './expenses';

const breakdown = (monthId: string) => ({
  monthId, totalDebits: 100,
  buckets: {
    credits: { total: 0, transactions: [] }, subscriptions: { total: 0, transactions: [] },
    savings: { total: 0, transactions: [] }, neutral: { total: 0, transactions: [] },
  },
  categories: [],
});

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const pending = vi.hoisted(() => ({ release: null as null | (() => void) }));
vi.mock('@/lib/api', () => ({
  ApiError: class extends Error { status = 0; },
  api: {
    post: vi.fn(),
    get: vi.fn((url: string) => {
      if (url === '/statements') return Promise.resolve([{ id: '2026-09' }, { id: '2026-08' }]);
      if (url.includes('monthId=2026-08')) {
        return new Promise((resolve) => { pending.release = () => resolve(breakdown('2026-08')); });
      }
      return Promise.resolve(breakdown('2026-09'));
    }),
  },
}));

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ExpensesPage />
    </QueryClientProvider>,
  );
}

describe('ExpensesPage — choix du mois (L84)', () => {
  it('le select du mois porte le nom accessible « Mois du relevé »', async () => {
    renderPage();
    expect(await screen.findByRole('combobox', { name: 'Mois du relevé' })).toBeTruthy();
  });

  it('t1 — changer de mois garde la page et le focus sur le select pendant le chargement', async () => {
    renderPage();
    const select = (await screen.findByRole('combobox', { name: 'Mois du relevé' })) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(2));
    select.focus();
    fireEvent.change(select, { target: { value: '2026-08' } });
    expect(screen.getByRole('combobox', { name: 'Mois du relevé' })).toBe(select);
    expect(document.activeElement).toBe(select);
    expect(select.value).toBe('2026-08');
    pending.release!();
    await waitFor(() => expect(screen.getByText(/Relevé 2026-08/)).toBeTruthy());
    expect(document.activeElement).toBe(select);
  });
});
