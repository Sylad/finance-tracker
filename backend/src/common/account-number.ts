/** Numéro de compte comparable : sans séparateurs, en majuscules. Source unique (savings, auto-sync). */
export function normalizeAccountNumber(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/[^0-9A-Z]/gi, '').toUpperCase();
}
