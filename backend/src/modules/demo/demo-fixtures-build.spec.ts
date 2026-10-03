import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * L49 — `DemoSeedService` lit `demo-fixtures.json` à côté de son `.js` compilé
 * (`__dirname`). `nest build` ne copie que ce que `nest-cli.json` déclare en
 * assets : sans déclaration, le fichier manque dans `dist/` et
 * `POST /api/demo/seed` répond 500 (ENOENT) sur une instance neuve.
 *
 * Ce test lance un vrai `nest build` (même nest-cli.json, même tsconfig.build)
 * vers un dossier jetable, puis vérifie que le fichier y est, identique à la
 * source.
 */
describe('build backend — assets de la démo (L49)', () => {
  const backendRoot = path.resolve(__dirname, '..', '..', '..');
  let workDir: string;

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-l49-build-'));
  });

  afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('copie demo-fixtures.json à côté de demo-seed.service.js dans le build', () => {
    const outDir = path.join(workDir, 'dist');
    const tsconfigPath = path.join(workDir, 'tsconfig.l49.json');
    fs.writeFileSync(
      tsconfigPath,
      JSON.stringify({
        extends: path.join(backendRoot, 'tsconfig.build.json'),
        // incremental: false — sinon le .tsbuildinfo peut tomber hors de workDir
        // (selon TMPDIR) et survivre au nettoyage.
        compilerOptions: {
          outDir,
          rootDir: path.join(backendRoot, 'src'),
          incremental: false,
        },
        // include/exclude d'un tsconfig se résolvent depuis SON dossier :
        // on les ancre sur le backend, comme tsconfig.build.json.
        include: [path.join(backendRoot, 'src', '**', '*')],
        exclude: [path.join(backendRoot, 'src', '**', '*spec.ts')],
      }),
    );

    execFileSync(
      process.execPath,
      [
        require.resolve('@nestjs/cli/bin/nest.js'),
        'build',
        // nest résout --path depuis le dossier courant, pas en absolu.
        '--path',
        path.relative(backendRoot, tsconfigPath),
      ],
      { cwd: backendRoot, stdio: 'pipe' },
    );

    const builtDemoDir = path.join(outDir, 'modules', 'demo');
    expect(fs.existsSync(path.join(builtDemoDir, 'demo-seed.service.js'))).toBe(
      true,
    );

    const built = path.join(builtDemoDir, 'demo-fixtures.json');
    expect(fs.existsSync(built)).toBe(true);
    const source = path.join(
      backendRoot,
      'src',
      'modules',
      'demo',
      'demo-fixtures.json',
    );
    expect(JSON.parse(fs.readFileSync(built, 'utf-8'))).toEqual(
      JSON.parse(fs.readFileSync(source, 'utf-8')),
    );
  }, 120_000);
});
