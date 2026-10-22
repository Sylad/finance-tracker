import type { ImportLog } from '@/types/api';

export type FileState = 'waiting' | 'running' | 'done';

export interface UploadProgress {
  states: FileState[];
  /** Rang du fichier en cours (ou du prochain à partir) : « fichier k / N ». */
  current: number;
  total: number;
}

/** multer relit les noms de fichier en latin1 : « é » arrive en « Ã© ». Rétablit l'UTF-8 si possible. */
export function fromLatin1(name: string): string {
  if ([...name].some((c) => c.charCodeAt(0) > 255)) return name;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(name, (c) => c.charCodeAt(0)));
  } catch {
    return name;
  }
}

/**
 * Le backend analyse les fichiers un par un et journalise chacun au moment où il le prend :
 * l'avancement se lit dans l'historique. Seuls les journaux apparus depuis l'envoi comptent
 * (`knownIds` = ceux qui existaient déjà), rapprochés des fichiers par nom (relu en latin1 par multer, d'où `fromLatin1`), dans l'ordre.
 */
export function fileProgress(filenames: string[], logs: ImportLog[], knownIds: Set<string>): UploadProgress {
  const fresh = logs
    .filter((l) => !knownIds.has(l.id))
    .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
  const states = filenames.map((name): FileState => {
    const i = fresh.findIndex((l) => l.filename === name || fromLatin1(l.filename) === name);
    if (i < 0) return 'waiting';
    const [l] = fresh.splice(i, 1);
    return l.status === 'in-progress' ? 'running' : 'done';
  });
  const started = states.filter((s) => s !== 'waiting').length;
  return { states, current: Math.min(Math.max(started, 1), filenames.length), total: filenames.length };
}
