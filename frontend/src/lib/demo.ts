const KEY = 'demoMode';

export const demoStore = {
  isActive(): boolean {
    return typeof window !== 'undefined' && window.sessionStorage.getItem(KEY) === 'true';
  },
  enable() {
    window.sessionStorage.setItem(KEY, 'true');
    window.location.reload();
  },
  disable() {
    window.sessionStorage.removeItem(KEY);
    window.location.reload();
  },
};
