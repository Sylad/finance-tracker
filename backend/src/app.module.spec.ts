import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { AppModule } from './app.module';

/**
 * L42 (2026-09-29, décision de Sylvain, comme warhammer40k L22) : le suivi
 * d'usage / solde Claude (claude-shared.json, claude-usage.json,
 * /api/claude/usage, /api/claude/balance) est retiré. Aucun contrôleur ne doit
 * plus être monté sous /api/claude. Les appels à Claude eux-mêmes (analyse des
 * relevés, catégorisation, amortissement…) restent.
 */
function controllerPaths(mod: unknown, seen = new Set<unknown>()): string[] {
  if (!mod || seen.has(mod)) return [];
  seen.add(mod);
  const target = (mod as { module?: unknown }).module ?? mod;
  const controllers: unknown[] = Reflect.getMetadata('controllers', target as object) ?? [];
  const imports: unknown[] = Reflect.getMetadata('imports', target as object) ?? [];
  const own = controllers.map((c) => String(Reflect.getMetadata(PATH_METADATA, c as object) ?? ''));
  return [...own, ...imports.flatMap((m) => controllerPaths(m, seen))];
}

describe('AppModule — suivi d’usage Claude retiré (L42)', () => {
  it('monte bien des contrôleurs (garde-fou du test lui-même)', () => {
    expect(controllerPaths(AppModule).map((p) => p.replace(/^\/+/, ''))).toContain('statements');
  });

  it('ne monte plus aucun contrôleur sous /api/claude (usage, balance…)', () => {
    const paths = controllerPaths(AppModule).map((p) => p.replace(/^\/+/, ''));
    expect(paths.filter((p) => p === 'claude' || p.startsWith('claude/'))).toEqual([]);
  });
});
