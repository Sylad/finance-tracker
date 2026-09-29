import { describe, it, expect } from 'vitest';
import * as queries from './queries';

/**
 * L42 (2026-09-29, décision de Sylvain) : le suivi d'usage / solde Claude est
 * retiré — plus d'appel à /api/claude/*, plus de carte « Budget Claude » sur le
 * tableau de bord.
 */
describe('suivi d’usage Claude retiré (L42)', () => {
  it('n’expose plus de hook vers /api/claude/usage ni /api/claude/balance', () => {
    expect(Object.keys(queries)).not.toContain('useClaudeUsage');
    expect(Object.keys(queries)).not.toContain('useUpdateClaudeBalance');
  });

  it('le tableau de bord ne monte plus la carte Budget Claude', () => {
    const files = import.meta.glob('../**/*.tsx', { eager: true, query: '?raw', import: 'default' });
    const offenders = Object.entries(files)
      .filter(([, src]) => /ClaudeUsage|\/claude\/(usage|balance)/.test(String(src)))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});
