import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BudgetPage } from './budget';
import { CATEGORY_LABELS, EXPENSE_CATEGORIES } from '@/types/api';

const state = vi.hoisted(() => ({
  budget: { isLoading: false, isError: false, isFetching: false, data: { food: 300 } as Record<string, number> | undefined, refetch: vi.fn() },
  demo: { data: { forced: false } as { forced: boolean } | undefined },
  mutateAsync: vi.fn(),
  isPending: false,
  blocker: undefined as undefined | { shouldBlockFn: () => boolean | Promise<boolean>; enableBeforeUnload?: boolean | (() => boolean) },
}));

vi.mock('@/lib/queries', () => ({
  useBudget: () => state.budget,
  useUpdateBudget: () => ({ mutateAsync: state.mutateAsync, isPending: state.isPending }),
  useDemoStatus: () => state.demo,
}));
vi.mock('@tanstack/react-router', () => ({
  useBlocker: (opts: NonNullable<typeof state.blocker>) => { state.blocker = opts; },
}));

const cat = EXPENSE_CATEGORIES[0];
const field = (c = cat) => screen.getByRole('textbox', { name: CATEGORY_LABELS[c] });
const saveButton = () => screen.getByRole('button', { name: /Enregistrer|Enregistrement/ });

describe('<BudgetPage /> — revue UX L24', () => {
  beforeEach(() => {
    state.budget = { isLoading: false, isError: false, isFetching: false, data: { [cat]: 300 }, refetch: vi.fn() };
    state.demo = { data: { forced: false } };
    state.mutateAsync = vi.fn().mockResolvedValue(undefined);
    state.isPending = false;
    state.blocker = undefined;
  });

  it('t1 — un enregistrement refusé affiche le message du serveur dans un role=alert et garde les montants saisis', async () => {
    state.mutateAsync.mockRejectedValue(new Error('Mode démo : écriture refusée'));
    const user = userEvent.setup();
    render(<BudgetPage />);
    await user.clear(field());
    await user.type(field(), '450');
    await user.click(saveButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Mode démo : écriture refusée');
    expect(field()).toHaveValue('450');
    expect(screen.queryByText('Enregistré')).not.toBeInTheDocument();
  });

  it('t1 — « Enregistré » est annoncé par un role=status', async () => {
    const user = userEvent.setup();
    render(<BudgetPage />);
    await user.type(field(), '0');
    await user.click(saveButton());
    expect(await screen.findByRole('status')).toHaveTextContent('Enregistré');
    expect(state.mutateAsync).toHaveBeenCalledWith({ [cat]: 3000 });
  });

  it('t1 — en démo verrouillée le bouton est désactivé avec la mention « Enregistrement désactivé en démo »', async () => {
    state.demo = { data: { forced: true } };
    const user = userEvent.setup();
    render(<BudgetPage />);
    await user.type(field(), '1');
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText('Enregistrement désactivé en démo')).toBeInTheDocument();
    expect(saveButton()).toHaveAccessibleDescription('Enregistrement désactivé en démo');
  });

  it('t2 — chaque champ a pour nom accessible sa catégorie et l’unité € lui est associée', () => {
    render(<BudgetPage />);
    for (const c of EXPENSE_CATEGORIES) {
      expect(field(c)).toHaveAccessibleName(CATEGORY_LABELS[c]);
      expect(field(c)).toHaveAccessibleDescription('€');
    }
    expect(screen.getAllByRole('textbox')).toHaveLength(EXPENSE_CATEGORIES.length);
  });

  it('t3 — un échec de chargement affiche ErrorState avec Réessayer et masque le formulaire', async () => {
    state.budget = { ...state.budget, isError: true, data: undefined };
    const user = userEvent.setup();
    render(<BudgetPage />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Enregistrer/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Réessayer/ }));
    expect(state.budget.refetch).toHaveBeenCalled();
  });

  it.each([['-5'], ['12,5'], ['12.5'], ['abc']])('t4 — « %s » est signalé sur son champ et bloque l’enregistrement', async (value) => {
    const user = userEvent.setup();
    render(<BudgetPage />);
    await user.clear(field());
    await user.type(field(), value);
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    const msg = document.getElementById(field().getAttribute('aria-describedby')!.split(' ').find((i) => i.includes('error'))!)!;
    expect(msg).toHaveTextContent(/entier/);
    await user.click(saveButton());
    expect(state.mutateAsync).not.toHaveBeenCalled();
  });

  it('t4 — un montant entier valide n’est pas signalé et step est retiré', async () => {
    const user = userEvent.setup();
    render(<BudgetPage />);
    await user.clear(field());
    await user.type(field(), '125');
    expect(field()).not.toHaveAttribute('aria-invalid', 'true');
    expect(field()).not.toHaveAttribute('step');
  });

  it('t5 — Entrée dans un champ enregistre ; le bouton est dans le formulaire, aligné à droite sous la carte', async () => {
    const user = userEvent.setup();
    render(<BudgetPage />);
    await user.type(field(), '5{Enter}');
    expect(state.mutateAsync).toHaveBeenCalledWith({ [cat]: 3005 });
    const form = field().closest('form')!;
    expect(form.className).toContain('max-w-2xl');
    expect(within(form).getByRole('button', { name: /Enregistrer/ })).toHaveAttribute('type', 'submit');
    expect(saveButton().parentElement!.className).toContain('justify-end');
  });

  it('t6 — Enregistrer est désactivé sans modification, actif après saisie, et le départ demande confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    render(<BudgetPage />);
    expect(saveButton()).toBeDisabled();
    expect(state.blocker!.shouldBlockFn()).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    await user.type(field(), '1');
    expect(saveButton()).toBeEnabled();
    expect(screen.getByText('Modifications non enregistrées')).toBeInTheDocument();
    expect(state.blocker!.shouldBlockFn()).toBe(true); // confirmation refusée : la navigation est bloquée
    expect(confirm).toHaveBeenCalledTimes(1);
    confirm.mockReturnValue(true);
    expect(state.blocker!.shouldBlockFn()).toBe(false);
    const before = state.blocker!.enableBeforeUnload;
    expect(typeof before === 'function' ? before() : before).toBe(true);
    confirm.mockRestore();
  });

  it('t6 — après un enregistrement réussi plus rien n’est à confirmer', async () => {
    const user = userEvent.setup();
    render(<BudgetPage />);
    await user.type(field(), '1');
    await user.click(saveButton());
    await waitFor(() => expect(saveButton()).toBeDisabled());
    expect(state.blocker!.shouldBlockFn()).toBe(false);
    await act(async () => {});
  });

  it('fix — une saisie faite pendant l’appel au serveur survit à la réponse', async () => {
    let resolve!: () => void;
    state.mutateAsync.mockReturnValue(new Promise<void>((r) => { resolve = r; }));
    const other = EXPENSE_CATEGORIES[1];
    const user = userEvent.setup();
    render(<BudgetPage />);
    await user.type(field(), '5{Enter}');
    await user.type(field(other), '200');
    await act(async () => { resolve(); });
    expect(field(other)).toHaveValue('200');
    expect(screen.getByText('Modifications non enregistrées')).toBeInTheDocument();
  });

  it('fix — un plafond décimal déjà enregistré n’est pas signalé et n’empêche pas d’enregistrer une autre catégorie', async () => {
    state.budget = { ...state.budget, data: { [cat]: 12.5 } };
    const other = EXPENSE_CATEGORIES[1];
    const user = userEvent.setup();
    render(<BudgetPage />);
    expect(field()).not.toHaveAttribute('aria-invalid', 'true');
    await user.type(field(other), '100{Enter}');
    expect(state.mutateAsync).toHaveBeenCalledWith({ [cat]: 12.5, [other]: 100 });
  });

  it('fix — un échec réseau du navigateur est annoncé en français', async () => {
    state.mutateAsync.mockRejectedValue(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    render(<BudgetPage />);
    await user.type(field(), '1{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(/injoignable/);
  });
});
