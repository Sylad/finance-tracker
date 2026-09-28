import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorState } from './loading-state';

describe('ErrorState (L21/t4)', () => {
  it("annonce l'erreur (role=alert) avec titre et message", () => {
    render(<ErrorState title="Impossible de charger les relevés" message="HTTP 500" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Impossible de charger les relevés');
    expect(alert).toHaveTextContent('HTTP 500');
  });

  it('propose « Réessayer » quand onRetry est fourni', async () => {
    const onRetry = vi.fn();
    render(<ErrorState message="boom" onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: /réessayer/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('sans onRetry : pas de bouton, titre par défaut « Erreur »', () => {
    render(<ErrorState message="boom" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Erreur');
  });
});
