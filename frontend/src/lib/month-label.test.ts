import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { monthAxisLabel, monthLabel } from './month-label';

describe('L182 — formateur partagé des mois', () => {
  it('forme de texte : « juillet 2026 », minuscule, année entière', () => {
    expect(monthLabel('2026-07')).toBe('juillet 2026');
    expect(monthLabel('2026-08')).toBe('août 2026');
    expect(monthLabel('2025-12')).toBe('décembre 2025');
  });

  it('forme d’axe : « Juil 26 »', () => {
    expect(monthAxisLabel('2026-07')).toBe('Juil 26');
    expect(monthAxisLabel('2026-02')).toBe('Fév 26');
  });

  it('un mois mal formé est une erreur, pas « undefined NaN »', () => {
    expect(() => monthLabel('juillet')).toThrow(/Mois invalide/);
  });
});

/**
 * Garde de source : sur /loans (la route et ses composants), un mois ne
 * s'écrit qu'avec `monthLabel` / `monthAxisLabel`. Tout autre formateur de
 * mois (formatMonth, formatMonthShort, toLocaleDateString / Intl avec une
 * option `month`, table de noms de mois) ferait revenir deux formes sur la page.
 */
describe('L182 — /loans n’écrit les mois que par le formateur partagé', () => {
  const src = resolve(__dirname, '..');
  const loanDir = resolve(src, 'components/loans');
  const files = [
    resolve(src, 'routes/loans.tsx'),
    ...readdirSync(loanDir)
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .map((f) => resolve(loanDir, f)),
  ];
  const interdits: [string, RegExp][] = [
    ['formatMonth', /\bformatMonth(Short)?\s*\(/],
    ['option month de toLocale*/Intl', /\bmonth\s*:\s*['"](long|short|narrow)['"]/],
    ['Intl.DateTimeFormat', /Intl\.DateTimeFormat/],
    ['noms de mois en dur', /['"](Juil|Juillet|juil\.?|juillet)['"]/],
  ];

  it('la garde lit bien les fichiers de /loans', () => {
    expect(files.length).toBeGreaterThan(5);
    expect(files.some((f) => f.endsWith('loans-monthly-chart.tsx'))).toBe(true);
  });

  for (const [nom, re] of interdits) {
    it(`aucun fichier n’utilise ${nom}`, () => {
      const fautifs = files.filter((f) => re.test(readFileSync(f, 'utf8')));
      expect(fautifs).toEqual([]);
    });
  }

  it('les deux graphiques passent par le formateur partagé', () => {
    for (const f of ['loans-monthly-chart.tsx', 'amortization-chart.tsx']) {
      const code = readFileSync(resolve(loanDir, f), 'utf8');
      expect(code).toContain("from '@/lib/month-label'");
      expect(code).toMatch(/tickFormatter=\{monthAxisLabel\}/);
    }
  });
});
