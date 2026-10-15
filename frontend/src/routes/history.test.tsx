import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HistoryPage } from './history';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock('@/lib/queries', () => ({
  useStatements: () => ({ isLoading: false, data: [] }),
}));

// jsdom n'a pas de mise en page : on verrouille les classes qui évitent le débordement à 390 px.
describe('HistoryPage — barre d’actions au téléphone', () => {
  it('laisse la barre passer à la ligne et le champ de recherche prendre la largeur', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <HistoryPage />
      </QueryClientProvider>,
    );
    const bar = screen.getByRole('button', { name: /Export CSV/ }).parentElement!;
    expect(bar.className).toContain('flex-wrap');
    const input = screen.getByPlaceholderText('Rechercher...');
    expect(input.className).toContain('w-full');
    expect(input.className).toContain('sm:w-64');
    expect(input.className).not.toMatch(/(^|\s)w-64/);
    expect(input.parentElement!.className).toContain('w-full');
  });
});
