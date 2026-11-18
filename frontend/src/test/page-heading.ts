import { expect } from 'vitest';
import { screen } from '@testing-library/react';
import { pageTitle } from '@/components/layout/page-title';

/**
 * L171 (WCAG 2.4.6) : le h1 d'une page est son nom — le libellé de navigation, celui du titre
 * d'onglet —, jamais un montant ; le chiffre clé, s'il y en a un, est sous le h1, hors de lui.
 */
export function expectPageHeading(path: string, figure?: RegExp) {
  const name = pageTitle(path).replace(/ — Finance Tracker$/, '');
  const h1s = screen.getAllByRole('heading', { level: 1 });
  expect(h1s).toHaveLength(1);
  expect(h1s[0].textContent).toBe(name);
  expect(h1s[0].textContent).not.toMatch(/\d/);
  if (figure) {
    const fig = screen.getByTestId('page-key-figure');
    expect(fig.textContent).toMatch(figure);
    expect(h1s[0].contains(fig)).toBe(false);
    expect(h1s[0].compareDocumentPosition(fig) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
}
