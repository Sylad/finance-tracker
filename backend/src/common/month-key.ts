/** Clé de mois `YYYY-MM` d'une date ISO `YYYY-MM-DD` (ou déjà `YYYY-MM`). */
export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}
