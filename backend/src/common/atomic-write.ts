import * as fs from 'fs';
import * as path from 'path';

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
 * Usage :
 *   await atomicWriteJson(this.filepath, all);
 *   // au lieu de :
 *   await fs.promises.writeFile(this.filepath, JSON.stringify(all, null, 2));
 */
export async function atomicWriteJson(filepath: string, data: unknown): Promise<void> {
  const tmp = `${filepath}.tmp.${process.pid}.${Date.now()}`;
  const dir = path.dirname(filepath);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.promises.rename(tmp, filepath);
}

/**
 * Variante synchrone — utilise quand on est dans un context où l'await
 * n'est pas dispo (init, hooks). Évite quand possible (bloque l'event loop).
 */
export function atomicWriteJsonSync(filepath: string, data: unknown): void {
  const tmp = `${filepath}.tmp.${process.pid}.${Date.now()}`;
  const dir = path.dirname(filepath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filepath);
}
