import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

/**
 * Écrit un fichier JSON de manière atomique.
 *
 * Pattern : write to `<file>.tmp` puis `rename(<file>.tmp, <file>)`. Sur la
 * plupart des FS POSIX (ext4, xfs, btrfs incl. Synology), `rename` est atomique
 * → soit l'ancienne version est lisible, soit la nouvelle. Jamais un fichier
 * tronqué/corrompu si le process crash en plein milieu.
 *
 * Pourquoi : un crash (SIGKILL, OOM, `docker stop`) pendant un `writeFile`
 * laisse le JSON partiellement écrit. Au prochain démarrage, `JSON.parse`
 * lève → crash-loop. Pattern observé sur warhammer/seed (cf. mémoire
 * `warhammer_seed_data.md`) et risque identifié par l'audit sur ol-companion
 * (12 writes non-atomiques).
 *
 * Le nom du tmp inclut un UUID : deux écritures concurrentes du même fichier
 * dans la même milliseconde partageaient le même tmp (`pid.Date.now()`) → le
 * 1er rename consommait le tmp, le 2e levait ENOENT (vécu : upload multi-PDF,
 * 2 requêtes parallèles loggant dans import-logs.json → 500). Les écritures
 * vers un même chemin sont aussi sérialisées in-process (file d'attente par
 * chemin) pour que la dernière écriture demandée soit bien l'état final.
 *
 * Usage :
 *   await atomicWriteJson(this.filepath, all);
 *   // au lieu de :
 *   await fs.promises.writeFile(this.filepath, JSON.stringify(all, null, 2));
 */
const writeQueues = new Map<string, Promise<void>>();

async function doAtomicWrite(filepath: string, data: unknown): Promise<void> {
  const tmp = `${filepath}.tmp.${process.pid}.${randomUUID()}`;
  const dir = path.dirname(filepath);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.promises.rename(tmp, filepath);
}

export function atomicWriteJson(filepath: string, data: unknown): Promise<void> {
  const prev = writeQueues.get(filepath) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(() => doAtomicWrite(filepath, data));
  writeQueues.set(filepath, next);
  void next
    .catch(() => undefined)
    .finally(() => {
      if (writeQueues.get(filepath) === next) writeQueues.delete(filepath);
    });
  return next;
}

/**
 * Variante synchrone — utilise quand on est dans un context où l'await
 * n'est pas dispo (init, hooks). Évite quand possible (bloque l'event loop).
 */
export function atomicWriteJsonSync(filepath: string, data: unknown): void {
  const tmp = `${filepath}.tmp.${process.pid}.${randomUUID()}`;
  const dir = path.dirname(filepath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filepath);
}
