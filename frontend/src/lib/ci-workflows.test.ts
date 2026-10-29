import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = (name: string) =>
  readFileSync(resolve(__dirname, '../../../.github/workflows', name), 'utf8');

describe('L55 — test-nginx-cache.sh joué en CI', () => {
  it('frontend-checks.yml lance le script après le build qui produit dist/', () => {
    const yml = workflow('frontend-checks.yml');
    // La ligne `run:` elle-même, non commentée : le `name:` de l'étape cite
    // aussi le script et ne prouve pas qu'il est joué.
    const build = yml.search(/^\s*run:\s*npm run build\s*$/m);
    const script = yml.search(/^\s*run:\s*(\.\/)?scripts\/test-nginx-cache\.sh\s*$/m);
    expect(build).toBeGreaterThan(-1);
    expect(script).toBeGreaterThan(build);
  });
});
