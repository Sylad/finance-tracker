import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoanForm } from './loan-form';
import type { LoanInput } from '@/types/api';

const INIT = {
  name: '', type: 'classic', category: 'consumer', monthlyPayment: 0, matchPattern: '',
} as LoanInput;

function renderForm() {
  render(<LoanForm init={INIT} onSave={vi.fn()} onCancel={vi.fn()} busy={false} />);
  const veil = screen.getByRole('heading', { name: 'Nouveau crédit' }).closest('.fixed') as HTMLElement;
  return { veil, panel: veil.firstElementChild as HTMLElement };
}

describe('<LoanForm /> — petit téléphone (L134, WCAG 1.4.10)', () => {
  it('R1 — le voile défile quand le formulaire dépasse l\'écran', () => {
    const { veil } = renderForm();
    expect(veil.className).toContain('overflow-y-auto');
  });

  it('R2 — le panneau part du haut du voile, jamais centré (sinon le haut sort de l\'écran, hors de portée du défilement)', () => {
    const { veil } = renderForm();
    expect(veil.className).toContain('items-start');
    expect(veil.className).not.toContain('items-center');
  });

  it('R3 — le panneau garde une marge verticale pour que le titre et Enregistrer restent atteignables', () => {
    const { panel } = renderForm();
    expect(panel.className).toContain('my-8');
  });

  it('R4 — Enregistrer reste dans le panneau défilable', () => {
    const { panel } = renderForm();
    expect(panel).toContainElement(screen.getByRole('button', { name: 'Enregistrer' }));
  });
});

describe('<LoanForm /> — clavier (L133, WCAG 2.4.3 / 4.1.2)', () => {
  it('R5 — fenêtre modale nommée « Nouveau crédit », focus sur Organisme', () => {
    renderForm();
    expect(screen.getByRole('dialog', { name: 'Nouveau crédit' }).getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: /Organisme/ }));
  });

  it('R6 — Échap annule', async () => {
    const onCancel = vi.fn();
    render(<LoanForm init={INIT} onSave={vi.fn()} onCancel={onCancel} busy={false} />);
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
