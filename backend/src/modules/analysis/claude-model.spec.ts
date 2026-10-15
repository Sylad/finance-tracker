import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { CLAUDE_MODEL } from './claude-model';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sources(p);
    return p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
  });
}

describe('CLAUDE_MODEL (L76)', () => {
  it('vaut claude-sonnet-5-5', () => {
    expect(CLAUDE_MODEL).toBe('claude-sonnet-5-5');
  });

  it("n'est plus codé en dur : plus aucun claude-sonnet-4-5 dans les sources", () => {
    const hits = sources(join(__dirname, '..', '..')).filter((f) =>
      readFileSync(f, 'utf8').includes('claude-sonnet-4-5'),
    );
    expect(hits).toEqual([]);
  });
});
