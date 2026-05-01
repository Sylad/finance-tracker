const SESSION_KEY = 'ft_pin';

export const authStore = {
  getPin(): string | null {
    return sessionStorage.getItem(SESSION_KEY);
  },
  setPin(pin: string): void {
    sessionStorage.setItem(SESSION_KEY, pin);
  },
  logout(): void {
    sessionStorage.removeItem(SESSION_KEY);
  },
  isAuthenticated(): boolean {
    return !!this.getPin();
  },
};
