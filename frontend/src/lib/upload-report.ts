import { ApiError } from './api';
import { formatMonth } from './utils';

export interface UploadFailure {
  filename: string;
  error: string;
}

const SERVER_ERROR = "Le serveur a rencontré une erreur : réessaie dans un instant, le relevé n'a pas été importé.";

/** Raisons par fichier d'un envoi refusé : le 422 les porte dans `errors[]`, les autres erreurs valent pour tous les fichiers. */
export function failuresFromUploadError(e: unknown, filenames: string[]): UploadFailure[] {
  const status = e instanceof ApiError ? e.status : 0;
  const errors = e instanceof ApiError ? (e.body as { errors?: unknown } | undefined)?.errors : undefined;
  if (status === 422 && Array.isArray(errors) && errors.length > 0) {
    return errors as UploadFailure[];
  }
  const message = status >= 500 ? SERVER_ERROR : String((e as Error).message);
  return filenames.map((filename) => ({ filename, error: message }));
}

/** « 2026-03 » → « Mars 2026 » ; un identifiant illisible est rendu tel quel. */
export function skippedMonthLabel(statementId: string): string {
  const m = statementId.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  return m ? formatMonth(Number(m[2]), Number(m[1])) : statementId;
}
