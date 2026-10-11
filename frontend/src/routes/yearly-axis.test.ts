import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatEURCompact } from '@/lib/utils';

describe('/yearly — axe des montants du cash flow (L65)', () => {
  const source = readFileSync('src/routes/yearly.tsx', 'utf8');

  it("formate l'axe avec formatEURCompact (euros fr-FR, pas de « 0.8 k€ » écrit à la main)", () => {
    expect(source).toContain('tickFormatter={formatEURCompact}');
    expect(source).not.toMatch(/k€`/);
  });

  it('écrit un bilan à 1 200 €/mois avec la virgule française, sans point décimal', () => {
    expect(formatEURCompact(1200)).not.toContain('.');
    expect(formatEURCompact(1200)).toMatch(/1\s?200/);
  });
});
