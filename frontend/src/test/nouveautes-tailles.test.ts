// L47 — chaque capture publiée dans les Nouveautés a sa taille réelle dans
// public/nouveautes-data/tailles.json (écrit par `npm run news`, versionné) : la page
// réserve sa place avant chargement, l'arrivée sur /nouveautes#<slug> ne dérive pas.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DATA = resolve(__dirname, '../../public/nouveautes-data');
const SIZES_FILE = join(DATA, 'tailles.json');

const pngSize = (file: string): [number, number] => {
  const buf = readFileSync(file);
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
};

describe('tailles des captures des Nouveautés (public/nouveautes-data/tailles.json)', () => {
  it('chaque capture publiée a une taille enregistrée, égale à sa taille réelle (sinon : npm run news à la racine)', () => {
    expect(existsSync(SIZES_FILE), 'tailles.json absent : npm run news à la racine').toBe(true);
    const sizes: Record<string, [number, number]> = JSON.parse(readFileSync(SIZES_FILE, 'utf8'));
    const { entries } = JSON.parse(readFileSync(join(DATA, 'nouveautes.json'), 'utf8')) as {
      entries: { slug: string; captures: string[] }[];
    };
    const captures = [...new Set(entries.flatMap((e) => e.captures))].sort();
    expect(captures.length).toBeGreaterThan(0);
    for (const c of captures) {
      expect(sizes[c], `${c} : aucune taille enregistrée dans tailles.json`).toBeDefined();
      expect(sizes[c], `${c} : taille enregistrée différente du PNG`).toEqual(pngSize(join(DATA, c)));
    }
    expect(Object.keys(sizes).sort(), 'tailles.json porte une capture qui n’est plus publiée').toEqual(captures);
  });

  it('npm run news (racine) écrit tailles.json après le build cadence', () => {
    const root = JSON.parse(readFileSync(resolve(__dirname, '../../../package.json'), 'utf8'));
    expect(root.scripts.news).toMatch(/cadence news build -o frontend\/public\/nouveautes-data && node frontend\/scripts\/nouveautes-tailles\.mjs$/);
  });
});
