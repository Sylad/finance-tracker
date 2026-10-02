// @vitest-environment node
// L50 — workflow « Contrôles frontend » : plan publié à jour, tests, build avec
// vérification de fuite, à CHAQUE push (pas de filtre de chemins), séparé du build d'images.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('../..', import.meta.url));
const wf = () => parse(readFileSync(`${root}/.github/workflows/frontend-checks.yml`, 'utf8'));

describe('workflow frontend-checks.yml (L50)', () => {
  it('se déclenche à chaque push de main, sans filtre de chemins', () => {
    const on = wf().on;
    expect(on.push.branches).toEqual(['main']);
    expect(on.push.paths).toBeUndefined();
    expect(on.push['paths-ignore']).toBeUndefined();
  });

  it('enchaîne plan --check, Vitest puis le build (qui finit par la vérification de fuite)', () => {
    const steps = Object.values(wf().jobs)[0].steps.map((s) => s.run ?? '').filter(Boolean);
    const at = (re) => steps.findIndex((r) => re.test(r));
    expect(at(/^npm ci\b/)).toBeGreaterThanOrEqual(0);
    expect(at(/plan-data\.mjs .*--check/)).toBeGreaterThan(at(/^npm ci\b/));
    expect(at(/vitest run/)).toBeGreaterThan(at(/plan-data\.mjs .*--check/));
    expect(at(/npm run build/)).toBeGreaterThan(at(/vitest run/));
    const pkg = JSON.parse(readFileSync(`${root}/frontend/package.json`, 'utf8'));
    expect(pkg.scripts.build).toMatch(/plan-data\.mjs .*--leaks dist$/);
  });

  it('ne touche ni au build d’images ni à deploy.sh (qui ne lit que build.yml)', () => {
    const build = readFileSync(`${root}/.github/workflows/build.yml`, 'utf8');
    expect(build).not.toMatch(/frontend-checks/);
    expect(readFileSync(`${root}/scripts/deploy.sh`, 'utf8')).toMatch(/--workflow build\.yml/);
    expect(JSON.stringify(wf())).not.toMatch(/docker|ghcr|packages: write/i);
  });
});
