import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginPage } from './login';

const navigate = vi.fn();
const verifyPin = vi.fn();

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('@/lib/api', () => ({ verifyPin: (pin: string) => verifyPin(pin) }));
vi.mock('@/lib/auth', () => ({ authStore: { setPin: vi.fn() } }));

const field = () => screen.getByLabelText(/PIN/);

describe('<LoginPage /> — revue UX L22', () => {
  beforeEach(() => {
    navigate.mockReset();
    verifyPin.mockReset();
  });

  it('t1 — le PIN invalide est annoncé (role alert) et relié au champ', async () => {
    verifyPin.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<LoginPage />);
    expect(field()).not.toHaveAttribute('aria-invalid', 'true');
    await user.type(field(), '1234');
    await user.click(screen.getByRole('button', { name: 'Déverrouiller' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('PIN invalide');
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    expect(field()).toHaveAttribute('aria-describedby', alert.id);
  });

  it('t2 — le focus revient dans le champ après un échec au clic ; bouton actif et aria-busy pendant l’appel ; double soumission ignorée', async () => {
    let resolve!: (ok: boolean) => void;
    verifyPin.mockReturnValue(new Promise<boolean>((r) => (resolve = r)));
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(field(), '1234');
    const button = screen.getByRole('button', { name: 'Déverrouiller' });
    await user.click(button);
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await user.click(button);
    await user.type(field(), '{Enter}');
    expect(verifyPin).toHaveBeenCalledTimes(1);
    await act(async () => resolve(false));
    await waitFor(() => expect(field()).toHaveFocus());
    expect(button).not.toHaveAttribute('aria-busy', 'true');
  });

  it('t3 — pendant la vérification le bouton dit « Déverrouillage… » et le spinner est masqué aux lecteurs d’écran', async () => {
    verifyPin.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(field(), '1234');
    await user.click(screen.getByRole('button', { name: 'Déverrouiller' }));
    const busy = screen.getByRole('button', { name: 'Déverrouillage…' });
    expect(busy.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('t4 — le PIN faux est vidé à l’échec, le message disparaît à la correction, la bordure d’erreur tient au focus', async () => {
    verifyPin.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(field(), '1234');
    await user.click(screen.getByRole('button', { name: 'Déverrouiller' }));
    await screen.findByRole('alert');
    expect(field()).toHaveValue('');
    expect(field()).toHaveClass('border-negative', 'focus:border-negative');
    await user.type(field(), '5');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(field()).not.toHaveAttribute('aria-invalid', 'true');
    expect(field()).not.toHaveAttribute('aria-describedby');
  });

  it('t5 — l’icône cadenas du libellé est masquée aux lecteurs d’écran', () => {
    render(<LoginPage />);
    const icon = field().closest('label')!.querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
});
