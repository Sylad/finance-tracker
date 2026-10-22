import { ApiError } from './api';
import { formatMonth } from './utils';

export interface UploadFailure {
  filename: string;
  error: string;
}

const UNREACHABLE = "Le serveur est momentanément injoignable : l'analyse a pu continuer, consulte l'historique des imports avant de relancer.";
const TOO_LARGE = 'Envoi trop volumineux : 20 Mo maximum par fichier.';
const SERVER_ERROR = "Le serveur a rencontré une erreur : réessaie dans un instant, le relevé n'a pas été importé.";

/** Raisons par fichier d'un envoi refusé : le 422 les porte dans `errors[]`, les autres erreurs valent pour tous les fichiers. */
export function failuresFromUploadError(e: unknown, filenames: string[]): UploadFailure[] {
  const status = e instanceof ApiError ? e.status : 0;
  const errors = e instanceof ApiError ? (e.body as { errors?: unknown } | undefined)?.errors : undefined;
  if (status === 422 && Array.isArray(errors) && errors.length > 0) {
    return errors as UploadFailure[];
  }
  return filenames.map((filename) => ({ filename, error: uploadErrorMessage(e, status) }));
}

/** Message français d'un envoi refusé ; « HTTP n » (réponse sans corps, ex. nginx) n'est jamais montré brut. */
function uploadErrorMessage(e: unknown, status: number): string {
  if (status === 502 || status === 503) return UNREACHABLE;
  if (status >= 500) return SERVER_ERROR;
  if (status === 413) return TOO_LARGE;
  const message = String((e as Error).message);
  return /^HTTP \d+$/.test(message) ? `Le serveur a refusé l'envoi (code ${status}).` : message;
}

/** « 2026-03 » → « Mars 2026 » ; un identifiant illisible est rendu tel quel. */
export function skippedMonthLabel(statementId: string): string {
  const m = statementId.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  return m ? formatMonth(Number(m[2]), Number(m[1])) : statementId;
}
