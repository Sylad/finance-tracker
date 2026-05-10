import { beforeEach, describe, expect, it } from 'vitest';
import { authStore } from './auth';

describe('authStore (login flow / PIN persistence in sessionStorage)', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('reports unauthenticated when no PIN has been set', () => {
    expect(authStore.isAuthenticated()).toBe(false);
    expect(authStore.getPin()).toBeNull();
  });

  it('persists the PIN into sessionStorage under the ft_pin key', () => {
    authStore.setPin('1234');
    expect(sessionStorage.getItem('ft_pin')).toBe('1234');
    expect(authStore.getPin()).toBe('1234');
    expect(authStore.isAuthenticated()).toBe(true);
  });

  it('logout() clears the PIN entry', () => {
    authStore.setPin('9876');
    authStore.logout();
    expect(authStore.getPin()).toBeNull();
    expect(sessionStorage.getItem('ft_pin')).toBeNull();
    expect(authStore.isAuthenticated()).toBe(false);
  });
});
