import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeclarationsPage } from './declarations';
import type { Declaration } from '@/types/api';

const decl: Declaration = {
  id: 'd1',
  type: 'expense',
  label: 'Assurance habitation',
  amount: 42.5,
  periodicity: 'monthly',
  startDate: '2026-01-05',
  endDate: null,
  category: 'insurance',
  notes: '',
  matchPattern: '',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

const state = vi.hoisted(() => ({
  list: { isLoading: false, isError: false, isFetching: false, data: [] as unknown[] | undefined, refetch: vi.fn() },
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/lib/queries', () => ({
  useDeclarations: () => state.list,
  useCreateDeclaration: () => ({ mutateAsync: state.create, isPending: false }),
  useUpdateDeclaration: () => ({ mutateAsync: state.update, isPending: false }),
  useDeleteDeclaration: () => ({ mutate: state.remove, isPending: false }),
}));

describe('Déclarations — erreurs montrées à l\'utilisateur (L87)', () => {
  beforeEach(() => {
    state.list = { isLoading: false, isError: false, isFetching: false, data: [decl], refetch: vi.fn() };
    state.create = vi.fn().mockResolvedValue(undefined);
    state.update = vi.fn().mockResolvedValue(undefined);
    state.remove = vi.fn();
    vi.stubGlobal('confirm', () => true);
  });

  it('R1 — chargement en échec : ErrorState avec Réessayer, pas l\'état vide', async () => {
    state.list = { isLoading: false, isError: true, isFetching: false, data: undefined, refetch: vi.fn() };
    render(<DeclarationsPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('Impossible de charger les déclarations.');
    expect(screen.queryByText("Aucune déclaration pour l'instant.")).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Réessayer/ }));
    expect(state.list.refetch).toHaveBeenCalledTimes(1);
  });

  it('R2 — un échec de rafraîchissement garde la liste déjà chargée', () => {
    state.list = { ...state.list, isError: true };
    render(<DeclarationsPage />);
    expect(screen.getByText('Assurance habitation')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  async function openAndSave() {
    const user = userEvent.setup();
    render(<DeclarationsPage />);
    await user.click(screen.getByRole('button', { name: /Nouvelle déclaration/ }));
    await user.type(screen.getByRole('textbox', { name: 'Libellé' }), 'Loyer');
    await user.clear(screen.getByLabelText('Montant (€)'));
    await user.type(screen.getByLabelText('Montant (€)'), '600');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    return user;
  }

  it('R3 — enregistrement refusé : message de l\'API en role=alert dans la modale, saisie conservée, modale ouverte', async () => {
    state.create.mockRejectedValue(new Error('Montant invalide'));
    await openAndSave();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Montant invalide');
    expect(screen.getByRole('textbox', { name: 'Libellé' })).toHaveValue('Loyer');
    expect(screen.getByLabelText('Montant (€)')).toHaveValue(600);
  });

  it('R4 — serveur injoignable (TypeError) : message explicite, pas « Failed to fetch »', async () => {
    state.create.mockRejectedValue(new TypeError('Failed to fetch'));
    await openAndSave();
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('Le serveur est injoignable');
  });

  it('R5 — l\'erreur disparaît au nouvel essai et la modale se ferme quand il réussit', async () => {
    state.create.mockRejectedValueOnce(new Error('Montant invalide'));
    const user = await openAndSave();
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(state.create).toHaveBeenCalledTimes(2);
  });

  it('R6 — rouvrir la modale n\'affiche pas l\'erreur précédente', async () => {
    state.create.mockRejectedValue(new Error('Montant invalide'));
    const user = await openAndSave();
    await user.click(screen.getByRole('button', { name: 'Fermer' }));
    await user.click(screen.getByRole('button', { name: /Nouvelle déclaration/ }));
    expect(within(screen.getByRole('dialog')).queryByRole('alert')).toBeNull();
  });

  it('R7 — suppression refusée : message nommant la déclaration en role=alert', async () => {
    state.remove.mockImplementation((_id: string, opts: { onError: (e: Error) => void }) =>
      opts.onError(new Error('Mode démo : écriture refusée')));
    render(<DeclarationsPage />);
    await userEvent.click(screen.getByRole('button', { name: /Supprimer/ }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Assurance habitation');
    expect(alert).toHaveTextContent('Mode démo : écriture refusée');
    expect(screen.getByText('Assurance habitation', { selector: 'span,div,p' })).toBeTruthy();
  });

  it('R8 — le message de suppression disparaît à la tentative suivante réussie', async () => {
    state.remove.mockImplementationOnce((_id: string, opts: { onError: (e: Error) => void }) => opts.onError(new Error('boum')));
    render(<DeclarationsPage />);
    const btn = screen.getByRole('button', { name: /Supprimer/ });
    await userEvent.click(btn);
    expect(screen.getByRole('alert')).toBeTruthy();
    await userEvent.click(btn);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
