import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeclarationForm } from './declarations';
import type { DeclarationInput } from '@/types/api';

const init: DeclarationInput = {
  type: 'expense',
  label: '',
  amount: 0,
  periodicity: 'monthly',
  startDate: null,
  endDate: null,
  category: '',
  notes: '',
  matchPattern: '',
};

function Harness({ onCancel = () => {} }: { onCancel?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Nouvelle déclaration</button>
      {open && (
        <DeclarationForm
          init={init}
          onSave={() => {}}
          onCancel={() => { onCancel(); setOpen(false); }}
          busy={false}
        />
      )}
    </>
  );
}

describe('Déclarations — modale de saisie (L85)', () => {
  it('rôle dialog modal, nommé par son titre', async () => {
    render(<DeclarationForm init={init} onSave={() => {}} onCancel={() => {}} busy={false} />);
    const dialog = screen.getByRole('dialog', { name: 'Nouvelle déclaration' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it("le focus arrive sur Libellé à l'ouverture", () => {
    render(<DeclarationForm init={init} onSave={() => {}} onCancel={() => {}} busy={false} />);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Libellé' }));
  });

  it('le bouton × a le nom accessible « Fermer » et ferme', async () => {
    const onCancel = vi.fn();
    render(<DeclarationForm init={init} onSave={() => {}} onCancel={onCancel} busy={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Échap ferme la modale', async () => {
    const onCancel = vi.fn();
    render(<DeclarationForm init={init} onSave={() => {}} onCancel={onCancel} busy={false} />);
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Échap venu d'une couche posée par-dessus (palette ⌘K) ne ferme pas la modale", async () => {
    const onCancel = vi.fn();
    render(
      <>
        <DeclarationForm init={init} onSave={() => {}} onCancel={onCancel} busy={false} />
        <input aria-label="Palette" />
      </>,
    );
    screen.getByRole('textbox', { name: 'Palette' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Tab et Maj+Tab bouclent dans la modale', async () => {
    render(<DeclarationForm init={init} onSave={() => {}} onCancel={() => {}} busy={false} />);
    const dialog = screen.getByRole('dialog');
    const first = screen.getByRole('button', { name: 'Fermer' });
    const last = screen.getByRole('button', { name: 'Enregistrer' });
    last.focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(first);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(last);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("à la fermeture le focus revient au bouton d'origine", async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Nouvelle déclaration' });
    await userEvent.click(opener);
    expect(screen.getByRole('dialog')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("à 320×568 la carte défile : hauteur bornée à 100dvh moins la marge de 2rem et overflow-y auto", () => {
    render(<DeclarationForm init={init} onSave={() => {}} onCancel={() => {}} busy={false} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('max-h-[calc(100dvh-2rem)]');
    expect(dialog.className).toContain('overflow-y-auto');
  });
});
