import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DedupeModal } from './dedupe-modal';
import { SuspiciousModal } from './suspicious-modal';

vi.mock('@/lib/queries', () => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
  useLoanDuplicates: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
  useMergeLoanDuplicates: mutation,
  useSuspiciousLoans: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
  useCleanupSuspiciousLoans: mutation,
  useConvertToInstallment: mutation,
  };
});

describe.each([
  ['Doublons', 'Détecter et fusionner les doublons', (onClose: () => void) => <DedupeModal onClose={onClose} />],
  ['Suspects', 'Crédits suspects', (onClose: () => void) => <SuspiciousModal onClose={onClose} />],
])('Crédits — fenêtre %s (L133, WCAG 2.4.3 / 4.1.2)', (_nom, titre, make) => {
  it('R1 — fenêtre modale nommée par son titre', () => {
    render(make(() => {}));
    expect(screen.getByRole('dialog', { name: titre }).getAttribute('aria-modal')).toBe('true');
  });

  it('R2 — le focus entre dans la fenêtre à l\'ouverture', () => {
    render(make(() => {}));
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('R3 — Échap ferme', async () => {
    const onClose = vi.fn();
    render(make(onClose));
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
