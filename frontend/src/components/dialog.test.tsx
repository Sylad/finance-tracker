import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog } from './dialog';

function Harness({ onClose = () => {}, withField = true }: { onClose?: () => void; withField?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Ouvrir</button>
      <button>Supprimer BNP</button>
      {open && (
        <Dialog title="Mon titre" description="Une aide" onClose={() => { onClose(); setOpen(false); }}>
          {withField && <input aria-label="Nom" />}
          <button>Valider</button>
        </Dialog>
      )}
    </>
  );
}

describe('<Dialog /> — fenêtre modale commune (L133, WCAG 2.4.3 / 4.1.2)', () => {
  it('R1 — rôle dialog modal, nommé par son titre', () => {
    render(<Dialog title="Mon titre" onClose={() => {}}><p>x</p></Dialog>);
    const dialog = screen.getByRole('dialog', { name: 'Mon titre' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('R2 — le focus arrive sur le premier champ à l\'ouverture', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Ouvrir' }));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Nom' }));
  });

  it('R3 — sans champ, le focus arrive sur la fenêtre elle-même, jamais sur une action', async () => {
    render(<Harness withField={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ouvrir' }));
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });

  it('R4 — Tab et Maj+Tab bouclent dans la fenêtre, sans atteindre la page derrière', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Ouvrir' }));
    const behind = screen.getByRole('button', { name: 'Supprimer BNP' });
    for (let i = 0; i < 6; i++) {
      await userEvent.tab();
      expect(document.activeElement).not.toBe(behind);
    }
    for (let i = 0; i < 6; i++) {
      await userEvent.tab({ shift: true });
      expect(document.activeElement).not.toBe(behind);
    }
  });

  it('R5 — Maj+Tab depuis la fenêtre elle-même ne sort pas non plus', async () => {
    render(<Harness withField={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ouvrir' }));
    await userEvent.tab({ shift: true });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(screen.getByRole('dialog'));
  });

  it('R6 — Échap ferme', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ouvrir' }));
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('R7 — à la fermeture, le focus revient au bouton d\'origine', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Ouvrir' });
    await userEvent.click(opener);
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(opener);
  });

  it('R8 — le bouton × est nommé « Fermer » et ferme', async () => {
    const onClose = vi.fn();
    render(<Dialog title="T" onClose={onClose}><p>x</p></Dialog>);
    await userEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('R9 — un clic sur le voile ferme, un clic dans le panneau non', async () => {
    const onClose = vi.fn();
    render(<Dialog title="T" onClose={onClose}><p>contenu</p></Dialog>);
    await userEvent.click(screen.getByText('contenu'));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('R10 — la description est reliée à la fenêtre (aria-describedby)', () => {
    render(<Dialog title="T" description="Une aide" onClose={() => {}}><p>x</p></Dialog>);
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Une aide');
  });
});
