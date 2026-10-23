import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PendingSuggestionsSignal } from './pending-suggestions-signal';
import { SuggestionsBanner, SUGGESTIONS_BANNER_ID } from './suggestions-banner';

const state = vi.hoisted(() => ({ suggestions: [] as unknown[] }));
const idle = { mutate: vi.fn(), isPending: false };

vi.mock('@/lib/queries', () => ({
  useLoanSuggestions: () => ({ data: state.suggestions }),
  useRejectSuggestion: () => idle,
  useSnoozeSuggestion: () => idle,
  useUnsnoozeSuggestion: () => idle,
  useAcceptInstallmentSuggestion: () => idle,
}));

const sugg = (id: string, status = 'pending', suggestedType = 'loan') => ({
  id, label: id, monthlyAmount: 50, occurrencesSeen: 3, status, suggestedType,
});

describe('<PendingSuggestionsSignal /> — suggestion en attente visible dès l\'arrivée (L139)', () => {
  beforeEach(() => { state.suggestions = []; });

  it('R1 — une suggestion de crédit en attente : « 1 suggestion à valider », au singulier', () => {
    state.suggestions = [sugg('a')];
    render(<PendingSuggestionsSignal />);
    expect(screen.getByRole('button', { name: /1 suggestion à valider/ })).toBeInTheDocument();
  });

  it('R2 — le pluriel suit le nombre de suggestions en attente', () => {
    state.suggestions = [sugg('a'), sugg('b')];
    render(<PendingSuggestionsSignal />);
    expect(screen.getByRole('button', { name: /2 suggestions à valider/ })).toBeInTheDocument();
  });

  it('R3 — rien à signaler : ni masquée, ni refusée, ni abonnement ne comptent', () => {
    state.suggestions = [sugg('a', 'snoozed'), sugg('b', 'rejected'), sugg('c', 'pending', 'subscription')];
    const { container } = render(<PendingSuggestionsSignal />);
    expect(container).toBeEmptyDOMElement();
  });

  it('R4 — le signal mène au bandeau : il y fait défiler la page et y place le focus', () => {
    state.suggestions = [sugg('a')];
    render(<><PendingSuggestionsSignal /><SuggestionsBanner onAccept={vi.fn()} /></>);
    const target = document.getElementById(SUGGESTIONS_BANNER_ID) as HTMLElement;
    expect(target).not.toBeNull();
    const scroll = vi.fn();
    target.scrollIntoView = scroll;
    fireEvent.click(screen.getByRole('button', { name: /1 suggestion à valider/ }));
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(target);
  });

  it('R5 — le bandeau garde son titre « Suggestions de Claude (N) » comme cible de l\'ancre', () => {
    state.suggestions = [sugg('a')];
    render(<SuggestionsBanner onAccept={vi.fn()} />);
    expect(document.getElementById(SUGGESTIONS_BANNER_ID)).toHaveTextContent('Suggestions de Claude (1)');
  });
});
