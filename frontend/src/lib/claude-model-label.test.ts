import { describe, it, expect } from 'vitest';

/**
 * L76 : la page « À propos » (publique) doit citer le modèle réellement utilisé
 * par le backend (`CLAUDE_MODEL`), pas un ancien.
 */
describe('modèle Claude affiché au public (L76)', () => {
  it('aucune source du frontend ne cite claude-sonnet-4-5', () => {
    const files = import.meta.glob('../**/*.{ts,tsx}', { eager: true, query: '?raw', import: 'default' });
    const offenders = Object.entries(files)
      .filter(([file]) => !file.endsWith('claude-model-label.test.ts'))
      .filter(([, src]) => /claude-sonnet-4-5/.test(String(src)))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it('la page À propos cite claude-sonnet-5-5', () => {
    const files = import.meta.glob('../routes/about.tsx', { eager: true, query: '?raw', import: 'default' });
    expect(Object.values(files).join('')).toContain('claude-sonnet-5-5');
  });
});
