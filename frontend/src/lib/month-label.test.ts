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
 * Garde de source : sur /loans (la route, ses composants et les modules de
 * `lib/` qu'ils importent), un mois ne s'écrit qu'avec `monthLabel` /
 * `monthAxisLabel`. Tout autre formateur de mois (formatMonth, formatMonthShort
 * — appelé, passé par référence ou importé sous un autre nom —,
 * toLocaleDateString / Intl avec une option `month` textuelle, table de noms
 * de mois) ferait revenir deux formes sur la page.
 * Hors garde : `lib/month-label.ts` (le formateur lui-même) et `lib/utils.ts`,
 * qui définit formatMonth pour d'autres pages — son usage sur /loans est pris
 * à l'import, par son nom.
 */
describe('L182 — /loans n’écrit les mois que par le formateur partagé', () => {
  const src = resolve(__dirname, '..');
  const loanDir = resolve(src, 'components/loans');
  const pageFiles = [
    resolve(src, 'routes/loans.tsx'),
    ...readdirSync(loanDir)
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .map((f) => resolve(loanDir, f)),
  ];
  const horsGarde = new Set(['month-label', 'utils']);
  const libFiles = [
    ...new Set(
      pageFiles.flatMap((f) =>
        [...readFileSync(f, 'utf8').matchAll(/from\s+['"]@\/lib\/([\w-]+)['"]/g)].map((m) => m[1]),
      ),
    ),
  ]
    .filter((m) => !horsGarde.has(m))
    .map((m) => resolve(src, 'lib', `${m}.ts`));
  const files = [...pageFiles, ...libFiles];

  const q = `['"\`]`;
  const moisFr =
    'janvier|janv\\.?|f[ée]vrier|f[ée]vr?\\.?|mars|avril|avr\\.?|mai|juin|juillet|juil\\.?|ao[uû]t|' +
    'septembre|sept?\\.?|octobre|oct\\.?|novembre|nov\\.?|d[ée]cembre|d[ée]c\\.?';
  const interdits: [string, RegExp][] = [
    // Le nom suffit : appel, référence (`tickFormatter={formatMonthShort}`),
    // import renommé (`formatMonthShort as m` nomme toujours la source).
    ['formatMonth / formatMonthShort', /\bformatMonth(Short)?\b/],
    ['option month textuelle de toLocale*/Intl', new RegExp(`\\bmonth\\s*:\\s*${q}(long|short|narrow)${q}`)],
    ['Intl.DateTimeFormat', /Intl\.DateTimeFormat/],
    ['noms de mois en dur', new RegExp(`${q}(${moisFr})${q}`, 'i')],
  ];

  it('la garde lit bien les fichiers de /loans et les modules de lib qu’ils importent', () => {
    expect(pageFiles.length).toBeGreaterThan(5);
    expect(files.some((f) => f.endsWith('loans-monthly-chart.tsx'))).toBe(true);
    expect(files.some((f) => f.endsWith('lib/amortization-series.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('lib/month-label.ts'))).toBe(false);
  });

  it('les motifs prennent les contournements connus et laissent les dates en jours', () => {
    const pris = (code: string) => interdits.some(([, re]) => re.test(code));
    // Contournements relevés par la revue r1 de L182.
    expect(pris('<XAxis tickFormatter={formatMonthShort} />')).toBe(true);
    expect(pris("import { formatMonthShort as m } from '@/lib/utils';")).toBe(true);
    expect(pris('import * as u from "@/lib/utils"; u.formatMonth(7, 2026)')).toBe(true);
    expect(pris('d.toLocaleDateString("fr-FR", { month: `short` })')).toBe(true);
    expect(pris("const NOMS = ['janv.', 'févr.', 'mars'];")).toBe(true);
    expect(pris('const m = "Août";')).toBe(true);
    expect(pris('const m = `Déc`;')).toBe(true);
    // Usages légitimes : jour (formatDate), formateur partagé, mot dans une phrase.
    expect(pris("d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })")).toBe(false);
    expect(pris('<Tooltip labelFormatter={monthLabel} />')).toBe(false);
    expect(pris("const t = 'Échéance prélevée en mai';")).toBe(false);
    expect(pris('const monthKey = row.month;')).toBe(false);
  });

  for (const [nom, re] of interdits) {
    it(`aucun fichier n’utilise ${nom}`, () => {
      const fautifs = files.filter((f) => re.test(readFileSync(f, 'utf8')));
      expect(fautifs).toEqual([]);
    });
  }

  it('les deux graphiques passent par le formateur partagé (axe court, infobulle longue)', () => {
    for (const f of ['loans-monthly-chart.tsx', 'amortization-chart.tsx']) {
      const code = readFileSync(resolve(loanDir, f), 'utf8');
      expect(code).toContain("from '@/lib/month-label'");
      expect(code).toMatch(/tickFormatter=\{monthAxisLabel\}/);
    }
    const charge = readFileSync(resolve(loanDir, 'loans-monthly-chart.tsx'), 'utf8');
    expect(charge).toMatch(/labelFormatter=\{monthLabel\}/);
  });
});
