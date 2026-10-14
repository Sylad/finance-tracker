import { foldAccents, slugify } from './text';

describe('foldAccents', () => {
  it('minuscules sans accents, ponctuation conservée', () => {
    expect(foldAccents('  Prêt-Été  ')).toBe('pret-ete');
  });
});

describe('slugify', () => {
  it('minuscules sans accents, ponctuation → un espace, bords rognés', () => {
    expect(slugify('Prêt-Été  (CA) ')).toBe('pret ete ca');
  });
  it('chaîne vide', () => {
    expect(slugify('')).toBe('');
  });
});
