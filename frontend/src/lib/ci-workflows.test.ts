import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = (name: string) =>
  readFileSync(resolve(__dirname, '../../../.github/workflows', name), 'utf8');

describe('L55 — test-nginx-cache.sh joué en CI', () => {
  it('frontend-checks.yml lance le script après le build qui produit dist/', () => {
    const yml = workflow('frontend-checks.yml');
    const build = yml.indexOf('run: npm run build');
    const script = yml.indexOf('scripts/test-nginx-cache.sh');
    expect(build).toBeGreaterThan(-1);
    expect(script).toBeGreaterThan(build);
  });
});
