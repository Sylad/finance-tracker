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

// Lignes de code d'un workflow, commentaires `#` retirés : un commentaire qui
// cite une commande ou un jeton ne prouve rien sur ce que le job exécute.
const code = (name: string) =>
  workflow(name)
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

describe('L58 — build.yml : la suite Jest ne voit jamais le jeton GHCR', () => {
  const yml = code('build.yml');
  const login = yml.search(/^\s*uses:\s*docker\/login-action@/m);
  const install = yml.search(/^\s*run:\s*npm ci\b/m);
  const jest = yml.search(/^\s*run:\s*npm test\s*$/m);

  it('R1 — npm ci et npm test précèdent le login GHCR', () => {
    expect(login).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(-1);
    expect(jest).toBeGreaterThan(install);
    expect(login).toBeGreaterThan(jest);
  });

  it('R2 — secrets.GITHUB_TOKEN n’est lu que par l’étape de login', () => {
    const uses = yml.match(/secrets\.GITHUB_TOKEN/g) ?? [];
    expect(uses).toHaveLength(1);
    expect(yml.search(/secrets\.GITHUB_TOKEN/)).toBeGreaterThan(login);
    // Aucun env: / token: au niveau du workflow ou du job qui l’exposerait
    // aux étapes de test avant le login.
    expect(yml.slice(0, login)).not.toMatch(/GITHUB_TOKEN|GHCR_TOKEN/);
  });

  it('R3 — npm ci des tests n’exécute aucun script d’installation des dépendances', () => {
    expect(yml).toMatch(/^\s*run:\s*npm ci\b[^\n]*--ignore-scripts\b/m);
  });

  it('R4 — le checkout ne laisse pas le jeton dans .git/config', () => {
    expect(yml).toMatch(/actions\/checkout@v4\s*\n\s*with:\s*\n\s*persist-credentials:\s*false/);
  });
});
