import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { TxRow, CATEGORY_COLOR, CATEGORY_TEXT_COLOR } from './tx-row';
import type { Transaction, TransactionCategory } from '@/types/api';

const tx = {
  id: 't1', date: '2025-09-02', description: 'PRELEVEMENT EDF CLIENTS PARTICULIERS', normalizedDescription: 'EDF',
  amount: -1234.56, category: 'utilities', subcategory: 'utilities', isRecurring: true,
} as unknown as Transaction;

function cells() {
  const { container } = render(<TxRow t={tx} onPickCategory={() => {}} />);
  const root = container.firstElementChild as HTMLElement;
  const find = (text: RegExp) => Array.from(root.querySelectorAll('div, button')).find((e) => e.children.length <= 2 && text.test(e.textContent ?? '') && e.parentElement === root) as HTMLElement;
  return {
    root,
    date: find(/02\/09/),
    amount: find(/1\s?234,56/),
    label: Array.from(root.children).find((e) => /récurrent/.test(e.textContent ?? '')) as HTMLElement,
  };
}

describe('ligne de transaction du relevé à 390 px (L78)', () => {
  it("R1 — le montant a sa propre colonne de largeur intrinsèque, sur la 1re rangée, jamais rogné", () => {
    const { root, amount, label } = cells();
    expect(root.className).toMatch(/grid-cols-\[minmax\(0,1fr\)_auto\]/);
    expect(amount.className).toMatch(/\brow-start-1\b/);
    expect(amount.querySelector('.whitespace-nowrap')?.textContent).toMatch(/1\s?234,56/);
    expect(label.className).toMatch(/\brow-start-1\b/);
    expect(label.className).toMatch(/\bmin-w-0\b/);
  });

  it("R2 — la date et la catégorie passent sur une 2e rangée", () => {
    const { date } = cells();
    expect(date.className).toMatch(/\brow-start-2\b/);
    const { container } = render(<TxRow t={tx} onPickCategory={() => {}} />);
    const badge = container.querySelector('button')!.parentElement!;
    expect(badge.className).toMatch(/\brow-start-2\b/);
  });

  it("R3 — dès md, la grille à 12 colonnes d'origine revient (rangée unique)", () => {
    const { root, date, amount } = cells();
    expect(root.className).toMatch(/md:grid-cols-12/);
    expect(date.className).toMatch(/md:row-start-auto/);
    expect(amount.className).toMatch(/md:col-span-3/);
  });

  it("R4 (L79) — « · récurrent » n'est rogné à aucune largeur : la sous-ligne passe à la ligne, jamais d'ellipse (ni dès md)", () => {
    const { label } = cells();
    expect(label.textContent).toMatch(/·\srécurrent/);
    const sub = Array.from(label.querySelectorAll('span')).find((e) => /^·.récurrent$/.test(e.textContent ?? ''))!.parentElement!;
    expect(sub.className).toMatch(/break-words/);
    expect(sub.className).not.toMatch(/truncate/);
  });

  it("R8 (L79) — le libellé brut sans marchand reconnu n'est pas tronqué au téléphone  ni plus large : le titre passe à la ligne (break-words), jamais d'ellipse", () => {
    const { container } = render(<TxRow t={{ ...tx, description: 'PRLV SEPA ASSOCIATION DES AMIS DU PETIT THEATRE 0123456789' } as unknown as Transaction} onPickCategory={() => {}} />);
    const title = Array.from(container.querySelectorAll('div')).find((e) => e.children.length === 0 && /ASSOCIATION DES AMIS/.test(e.textContent ?? '') && /font-medium/.test(e.className))!;
    expect(title.className).toMatch(/break-words/);
    expect(title.className).not.toMatch(/(^|\s)truncate/);
  });

  it("R6 — la sous-ligne a de vraies espaces ordinaires entre description, catégorie et « · récurrent » (sinon un seul mot, coupé n'importe où) ; « · » reste collé à « récurrent »", () => {
    const { label } = cells();
    const sub = Array.from(label.querySelectorAll('span')).find((e) => /^·.récurrent$/.test(e.textContent ?? ''))!.parentElement!;
    const texte = sub.textContent ?? '';
    expect(texte).toContain(`${tx.description} `);
    expect(texte).toMatch(/\S \S+( \S+)* ·\u00a0récurrent$/);
    expect(texte).not.toMatch(/\S·/);
  });

  it("R7 — le nowrap ne porte que sur le montant : la note « dont … exceptionnel » ne fixe pas la largeur de la colonne et passe à la ligne", () => {
    const { container } = render(<TxRow t={{ ...tx, amount: 37000, exceptionalAmount: 30000 } as unknown as Transaction} onPickCategory={() => {}} />);
    const note = Array.from(container.querySelectorAll('div')).find((e) => /exceptionnel/.test(e.textContent ?? '') && e.children.length === 0)!;
    const amount = note.parentElement!;
    expect(amount.className).not.toMatch(/(^|\s)whitespace-nowrap/);
    expect(note.className).toMatch(/\bw-0\b/);
    expect(note.className).toMatch(/\bmin-w-full\b/);
    const figure = Array.from(amount.querySelectorAll('span')).find((e) => /37\s?000/.test(e.textContent ?? ''))!;
    expect(figure.className).toMatch(/whitespace-nowrap/);
  });

  it("R5 — dès md le montant et la note « dont … exceptionnel » retrouvent leur largeur et le retour à la ligne (grand écran inchangé)", () => {
    const { container } = render(<TxRow t={{ ...tx, amount: 37000, exceptionalAmount: 30000 } as unknown as Transaction} onPickCategory={() => {}} />);
    const note = Array.from(container.querySelectorAll('div')).find((e) => /exceptionnel/.test(e.textContent ?? '') && e.children.length === 0)!;
    const figure = Array.from(note.parentElement!.querySelectorAll('span')).find((e) => /37\s?000/.test(e.textContent ?? ''))!;
    expect(figure.className).toMatch(/\bmd:whitespace-normal\b/);
    expect(note.className).toMatch(/\bmd:w-auto\b/);
    expect(note.className).toMatch(/\bmd:min-w-0\b/);
  });
});

// Contraste WCAG 1.4.3 de la puce de catégorie sur le fond réel des lignes : --surface de la carte (teinte du fond comprise, lue sur la puce rendue).
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
function parseHsl(c: string): [number, number, number] {
  const m = c.match(/hsl\((\d+) (\d+)% (\d+)%\)/)!;
  return hslToRgb(+m[1], +m[2], +m[3]);
}
function luminance([r, g, b]: number[]) {
  const lin = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// Fond RÉELLEMENT rendu de la puce : la teinte `color-mix(in srgb, <couleur> N%, transparent)` posée en style (jsdom la relit en rgb), composée sur --surface.
function renderedChipBackground(cat: TransactionCategory, surface: [number, number, number]): [number, number, number] {
  const { container } = render(<TxRow t={{ ...tx, category: cat } as Transaction} onPickCategory={() => {}} />);
  const raw = container.querySelector('button')!.getAttribute('style') ?? '';
  const m = raw.match(/background:\s*color-mix\(in srgb, rgb\((\d+), (\d+), (\d+)\) (\d+(?:\.\d+)?)%, transparent\)/);
  if (!m) throw new Error(`fond de puce non valide ou absent pour ${cat} : « ${raw} »`);
  const a = +m[4] / 100;
  const tint = [+m[1], +m[2], +m[3]];
  return [0, 1, 2].map((k) => tint[k] * a + surface[k] * (1 - a)) as [number, number, number];
}

describe('puces de catégorie (L23/t1)', () => {
  it('R1 — chaque puce atteint 4,5:1 sur son fond rendu (teinte de la catégorie composée sur --surface)', () => {
    const surface = parseHsl('hsl(222 19% 10%)');
    for (const cat of Object.keys(CATEGORY_COLOR) as TransactionCategory[]) {
      const bg = renderedChipBackground(cat, surface);
      const fg = parseHsl(CATEGORY_TEXT_COLOR[cat]);
      const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
      const ratio = (hi + 0.05) / (lo + 0.05); expect({ cat, ok: ratio >= 4.5 }).toEqual({ cat, ok: true });
    }
  });

  it('R3 — le fond de la puce est une teinte CSS valide : jamais une couleur suivie de « 20 »', () => {
    const { container } = render(<TxRow t={{ ...tx, category: 'food' } as Transaction} onPickCategory={() => {}} />);
    const style = container.querySelector('button')!.getAttribute('style') ?? '';
    expect(style).toMatch(/background:\s*color-mix\(in srgb, rgb\(191, 90, 242\) \d+(\.\d+)?%, transparent\)/);
    expect(style).not.toMatch(/\)20/);
  });

  it('R1b — seules les teintes sous 4,5:1 sur leur fond rendu sont éclaircies (Autre, Virements, Logement, Alimentation, Santé, Loisirs)', () => {
    const changed = (Object.keys(CATEGORY_COLOR) as TransactionCategory[]).filter((c) => CATEGORY_TEXT_COLOR[c] !== CATEGORY_COLOR[c]);
    expect(changed.sort()).toEqual(['entertainment', 'food', 'health', 'housing', 'other', 'transfers']);
  });

  it('R2 — la puce rendue utilise la couleur de texte accessible', () => {
    const { container } = render(<TxRow t={{ ...tx, category: 'other' } as Transaction} onPickCategory={() => {}} />);
    const btn = container.querySelector('button')!;
    const probe = (c: string) => { const e = document.createElement('span'); e.style.color = c; return e.style.color; };
    expect(btn.style.color).toBe(probe(CATEGORY_TEXT_COLOR.other));
    expect(btn.style.color).not.toBe(probe(CATEGORY_COLOR.other));
  });
});
