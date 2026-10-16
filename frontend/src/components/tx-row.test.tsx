import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { TxRow } from './tx-row';
import type { Transaction } from '@/types/api';

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
    expect(amount.className).toMatch(/whitespace-nowrap/);
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

  it("R4 — « · récurrent » n'est pas rogné au téléphone : la sous-ligne passe à la ligne, ne tronque que dès md", () => {
    const { label } = cells();
    expect(label.textContent).toMatch(/· récurrent/);
    const sub = Array.from(label.querySelectorAll('span')).find((e) => e.textContent === '· récurrent')!.parentElement!;
    expect(sub.className).toMatch(/break-words/);
    expect(sub.className).toMatch(/md:truncate/);
    expect(sub.className).not.toMatch(/(^|\s)truncate/);
  });
});
