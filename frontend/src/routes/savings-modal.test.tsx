import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SavingsPage } from './savings';
import type { SavingsAccount } from '@/types/api';

const account = {
  id: 'a', name: 'Livret A', type: 'livret-a', initialBalance: 100, initialBalanceDate: '2026-01-01',
  matchPattern: '', accountNumber: '', interestRate: 0.015, interestAnniversaryMonth: 12,
  currentBalance: 100, movements: [],
} as unknown as SavingsAccount;

const idle = { mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false };

vi.mock('@/lib/queries', () => ({
  useSavingsAccounts: () => ({ data: [account], isLoading: false }),
  useCreateSavingsAccount: () => idle,
  useUpdateSavingsAccount: () => idle,
  useDeleteSavingsAccount: () => idle,
  useSavingsHistory: () => ({ data: [] }),
  useResyncSavings: () => idle,
}));

async function openNew() {
  render(<SavingsPage />);
  const opener = screen.getByRole('button', { name: 'Ajouter un compte' });
  await userEvent.click(opener);
  return opener;
}

describe('<SavingsPage /> — fenêtre Modifier/Nouveau compte (L117)', () => {
  it('R1 — rôle dialog modal, nommé par son titre (Nouveau compte, puis Modifier le compte)', async () => {
    await openNew();
    const dialog = screen.getByRole('dialog', { name: 'Nouveau compte épargne' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Modifier Livret A' }));
    expect(screen.getByRole('dialog', { name: 'Modifier le compte' })).toBeInTheDocument();
  });

  it("R2 — le focus arrive sur Nom à l'ouverture", async () => {
    await openNew();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Nom' }));
  });

  it('R3 — Échap ferme la fenêtre', async () => {
    await openNew();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('R4 — Tab et Maj+Tab bouclent dans la fenêtre', async () => {
    await openNew();
    const first = screen.getByRole('button', { name: 'Fermer' });
    const last = screen.getByRole('button', { name: 'Enregistrer' });
    last.focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(first);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(last);
  });

  it("R5 — à la fermeture le focus revient au bouton d'origine", async () => {
    const opener = await openNew();
    // Le focus a quitté le bouton pour la fenêtre, puis lui revient à la fermeture.
    expect(document.activeElement).not.toBe(opener);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('R6 — le voile défile et la carte est bornée à 100dvh moins 2rem, titre et × restent collés en haut', async () => {
    await openNew();
    const dialog = screen.getByRole('dialog');
    expect(dialog.parentElement!.className).toContain('overflow-y-auto');
    expect(dialog.className).toContain('max-h-[calc(100dvh-2rem)]');
    expect(dialog.className).toContain('overflow-y-auto');
    expect(screen.getByRole('heading', { name: 'Nouveau compte épargne' }).parentElement!.className).toContain('sticky');
  });

  it('R7 — une seule colonne sous sm : aucune grille de champs n’est à 2 colonnes d’emblée', async () => {
    await openNew();
    const grids = screen.getByRole('dialog').querySelectorAll('form .grid');
    expect(grids.length).toBe(3);
    for (const g of grids) {
      expect(g.className).toContain('grid-cols-1');
      expect(g.className).toContain('sm:grid-cols-2');
      expect(g.className).not.toMatch(/(^|\s)grid-cols-2/);
    }
  });

  it('R3 (L121) — la carte affiche le taux en fr-FR et le champ le taux arrondi', async () => {
    account.interestRate = 0.017;
    render(<SavingsPage />);
    expect(screen.getByText(/1,70\s%/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Modifier Livret A' }));
    expect((screen.getByLabelText("Taux d'intérêt (%)") as HTMLInputElement).value).toBe('1.7');
    account.interestRate = 0.015;
  });
});
