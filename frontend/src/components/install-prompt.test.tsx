import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InstallPrompt } from './install-prompt';

interface MockBeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'ft_install_dismissed_at';

function fireBeforeInstallPrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt') as MockBeforeInstallPromptEvent;
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome });
  // Wrap in act() to flush the state update synchronously and silence the
  // "not wrapped in act(...)" React warning.
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

describe('<InstallPrompt /> — interaction', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing until a beforeinstallprompt event fires', () => {
    const { container } = render(<InstallPrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the banner when beforeinstallprompt fires, and hides it after dismiss', async () => {
    const user = userEvent.setup();
    render(<InstallPrompt />);

    fireBeforeInstallPrompt();

    expect(await screen.findByText('Installer Finance Tracker')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Plus tard' }));

    await waitFor(() => {
      expect(screen.queryByText('Installer Finance Tracker')).not.toBeInTheDocument();
    });
    // Dismissal stored a timestamp under the dedicated key
    expect(localStorage.getItem(DISMISS_KEY)).not.toBeNull();
  });

  it('respects an existing dismissal within the 14-day TTL', () => {
    // Set a dismissal 1 day ago — must suppress the banner
    localStorage.setItem(DISMISS_KEY, String(Date.now() - 86400 * 1000));
    render(<InstallPrompt />);
    fireBeforeInstallPrompt();
    expect(screen.queryByText('Installer Finance Tracker')).not.toBeInTheDocument();
  });

  it('re-shows the banner when the previous dismissal is older than the TTL', async () => {
    // 30 days ago > 14-day TTL
    localStorage.setItem(DISMISS_KEY, String(Date.now() - 30 * 86400 * 1000));
    render(<InstallPrompt />);
    fireBeforeInstallPrompt();
    expect(await screen.findByText('Installer Finance Tracker')).toBeInTheDocument();
  });

  it('calls evt.prompt() when the user clicks Installer', async () => {
    const user = userEvent.setup();
    render(<InstallPrompt />);
    const evt = fireBeforeInstallPrompt('accepted');

    await screen.findByText('Installer Finance Tracker');
    await user.click(screen.getByRole('button', { name: 'Installer' }));

    expect(evt.prompt).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.queryByText('Installer Finance Tracker')).not.toBeInTheDocument();
    });
  });

  it('hides the banner when the OS appinstalled event fires', async () => {
    render(<InstallPrompt />);
    fireBeforeInstallPrompt();
    await screen.findByText('Installer Finance Tracker');

    act(() => {
      fireEvent(window, new Event('appinstalled'));
    });

    await waitFor(() => {
      expect(screen.queryByText('Installer Finance Tracker')).not.toBeInTheDocument();
    });
  });
});
