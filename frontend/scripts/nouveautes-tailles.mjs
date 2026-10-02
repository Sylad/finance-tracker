// L47 — après `cadence news build` (npm run news à la racine) : écrit
// public/nouveautes-data/tailles.json, { "captures/x.png": [largeur, hauteur] }, lu par
// la page /nouveautes pour réserver la place de chaque capture AVANT son chargement
// (width/height + aspect-ratio). Sans cela, les captures chargées en différé grandissent
// après l'arrivée sur /nouveautes#<slug> et repoussent l'entrée visée hors de l'écran.
// Porté d'ol-companion (L13).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = fileURLToPath(new URL('../public/nouveautes-data/', import.meta.url));
const { entries } = JSON.parse(readFileSync(join(DATA, 'nouveautes.json'), 'utf8'));

const sizes = {};
for (const c of [...new Set(entries.flatMap((e) => e.captures))].sort()) {
  const buf = readFileSync(join(DATA, c));
  if (buf.toString('ascii', 1, 4) !== 'PNG') throw new Error(`${c} : capture non PNG`);
  sizes[c] = [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}
writeFileSync(join(DATA, 'tailles.json'), JSON.stringify(sizes, null, 2) + '\n');
console.log(`tailles.json : ${Object.keys(sizes).length} capture(s)`);
