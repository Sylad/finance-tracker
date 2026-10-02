import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// WCAG 2.2 SC 1.4.3 : texte courant ≥ 4,5:1. Le jeton --fg-dim sert aux
// étiquettes et aux graduations des graphiques, posés sur les cartes
// (--surface) et sur les lignes survolées (--surface-2). Vérifié par calcul
// sur les valeurs HSL réelles de index.css (L21/t1), pas à l'œil.

const css = fs.readFileSync(path.resolve(__dirname, '../index.css'), 'utf8');

function token(name: string): [number, number, number] {
  const m = css.match(new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`));
  if (!m) throw new Error(`jeton --${name} introuvable`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  const S = s / 100;
  const L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255)) as [number, number, number];
}

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRgb(fg: [number, number, number], bg: [number, number, number]): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

function contrast(fg: string, bg: string): number {
  return contrastRgb(hslToRgb(token(fg)), hslToRgb(token(bg)));
}

describe('contraste des jetons de texte (WCAG 1.4.3)', () => {
  it('reproduit le calcul de la revue : ancien fg-dim 220 10% 47% sur surface = 3,78:1', () => {
    expect(hslToRgb([220, 10, 47])).toEqual([108, 116, 132]);
    expect(hslToRgb(token('surface'))).toEqual([21, 24, 30]);
    expect(contrastRgb([108, 116, 132], [21, 24, 30])).toBeCloseTo(3.78, 2);
  });

  for (const bg of ['bg', 'surface', 'surface-2']) {
    it(`fg-dim sur ${bg} ≥ 4,5:1`, () => {
      expect(contrast('fg-dim', bg)).toBeGreaterThanOrEqual(4.5);
    });
    it(`fg-muted sur ${bg} ≥ 4,5:1`, () => {
      expect(contrast('fg-muted', bg)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('fg-dim reste plus discret que fg-muted (hiérarchie conservée)', () => {
    expect(contrast('fg-dim', 'surface')).toBeLessThan(contrast('fg-muted', 'surface'));
  });

  // Badges (.badge-*) : texte 12 px sur fond translucide bg-<ton>/15 posé sur
  // la carte (ou la ligne survolée). Le fond réel est le mélange alpha
  // composé — c'est lui qu'il faut mesurer (contre-revue prod L21/t10 : badge
  // bleu à 4,06:1).
  const composite = (fg: string, bg: string, alpha: number): [number, number, number] => {
    const f = hslToRgb(token(fg));
    const b = hslToRgb(token(bg));
    return f.map((v, i) => Math.round(alpha * v + (1 - alpha) * b[i])) as [number, number, number];
  };

  it('reproduit la mesure de la contre-revue : texte info sur info/15 composé sur surface = 4,06:1', () => {
    expect(contrastRgb(hslToRgb(token('info')), composite('info', 'surface', 0.15))).toBeCloseTo(4.06, 2);
  });

  const BADGES: Array<[string, string, string]> = [
    ['badge-info', 'info-fg', 'info'],
    ['badge-negative', 'negative-fg', 'negative'],
    ['badge-positive', 'positive', 'positive'],
    ['badge-warning', 'warning', 'warning'],
  ];
  for (const [badge, text, tone] of BADGES) {
    it(`${badge} utilise le jeton de texte ${text}`, () => {
      expect(css).toMatch(new RegExp(`\\.${badge}\\s*\\{[^}]*bg-${tone}/15[^}]*text-${text}[\\s;]`));
    });
    for (const bg of ['surface', 'surface-2']) {
      it(`${badge} : texte ${text} sur ${tone}/15 composé sur ${bg} ≥ 4,5:1`, () => {
        expect(contrastRgb(hslToRgb(token(text)), composite(tone, bg, 0.15))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  // L47 : pastille « nouveau » des Nouveautés — texte --bg sur fond --accent plein.
  it('pastille Nouveautés : texte bg sur accent plein ≥ 4,5:1', () => {
    expect(contrast('bg', 'accent')).toBeGreaterThanOrEqual(4.5);
  });
  it('pastille Nouveautés : la classe utilise bien bg-accent et text-bg', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../components/news-badge.tsx'), 'utf8');
    expect(src).toMatch(/bg-accent /);
    expect(src).toMatch(/text-bg['\s]/);
  });
});
