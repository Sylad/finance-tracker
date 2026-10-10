import 'reflect-metadata';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../../app.module';
import { PinGuard } from '../../guards/pin.guard';
import { DemoWriteGuard } from '../../guards/demo-write.guard';
import { RequestDataDirService } from './request-data-dir.service';

/**
 * L60 : démo locale isolée pour la revue UX automatique (`local/ux-demo.sh`,
 * branchée sur `orchestrate.ux` de cadence.yaml). Elle tourne sur la machine
 * qui porte les VRAIES données (`data-local/`) : la garantie à prouver est
 * qu'aucun fichier de `data-local/` (ni de `data/`) n'est ouvert, ni par la
 * configuration du lanceur, ni par le backend qu'il démarre.
 */
const REPO = path.resolve(__dirname, '../../../..');
const SCRIPT = path.join(REPO, 'local', 'ux-demo.sh');
const FORBIDDEN = [path.join(REPO, 'data-local'), path.join(REPO, 'data'), path.join(REPO, 'backend', 'data')];

function inside(child: string, parent: string): boolean {
  const rel = path.relative(parent, path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function printEnv(extra: NodeJS.ProcessEnv = {}): Record<string, string> {
  const out = execFileSync('bash', [SCRIPT, '--print-env'], {
    env: { ...process.env, ...extra },
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const env: Record<string, string> = {};
  for (const line of out.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
  }
  return env;
}

describe('démo locale isolée (L60) — environnement du lanceur', () => {
  it('verrouille la démo, sans PIN, sur les ports 3052 / 5192', () => {
    const env = printEnv();
    expect(env.DEMO_FORCED).toBe('true');
    expect(env.APP_PIN).toBe('');
    expect(env.ANTHROPIC_API_KEY).toBe(''); // pas de clé : la démo ne dépense rien
    expect(env.PORT).toBe('3052');
    expect(env.FRONT_PORT).toBe('5192');
    expect(env.CORS_ORIGIN).toBe('http://localhost:5192');
    expect(env.VITE_API_TARGET).toBe('http://localhost:3052');
  });

  it('n’empiète sur aucun port connu des autres instances (réelle 3000/4200, ol-companion 3002/5174, Vite 5173)', () => {
    const env = printEnv();
    const taken = ['3000', '4200', '3002', '5174', '5173', '3010', '4201', '4202', '4204'];
    expect(taken).not.toContain(env.PORT);
    expect(taken).not.toContain(env.FRONT_PORT);
    // Le port annoncé à cadence est bien celui du frontend de la démo.
    const cadence = fs.readFileSync(path.join(REPO, 'cadence.yaml'), 'utf-8');
    expect(cadence).toContain(`url: http://localhost:${env.FRONT_PORT}`);
    expect(cadence).not.toMatch(/localhost:(5174|3002)/);
  });

  it('place DATA_DIR et UPLOAD_DIR hors de data-local/ et de data/', () => {
    const env = printEnv();
    expect(path.isAbsolute(env.DATA_DIR)).toBe(true);
    expect(inside(env.UPLOAD_DIR, env.DATA_DIR)).toBe(true);
    for (const f of FORBIDDEN) {
      expect(inside(env.DATA_DIR, f)).toBe(false);
      expect(inside(env.UPLOAD_DIR, f)).toBe(false);
    }
  });

  it('refuse un UX_DEMO_DIR qui pointe dans data-local/ ou data/ (ou les contient)', () => {
    for (const bad of [path.join(REPO, 'data-local'), path.join(REPO, 'data-local', 'x'), path.join(REPO, 'data'), REPO]) {
      expect(() => printEnv({ UX_DEMO_DIR: bad })).toThrow();
    }
  });
});

describe('démo locale isolée (L60) — le backend n’ouvre aucun fichier de data-local/', () => {
  const touched: string[] = [];
  const spies: jest.SpyInstance[] = [];
  const saved: Record<string, string | undefined> = {};
  let app: NestExpressApplication;
  let demoDir: string;

  beforeAll(async () => {
    demoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ux-demo-spec-'));
    const env = printEnv({ UX_DEMO_DIR: demoDir });
    for (const [k, v] of Object.entries(env)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    // `import * as fs` est une copie à accesseurs : on espionne le vrai module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const realFs = require('fs') as typeof fs;
    // Trace tout chemin passé à fs (sync, callback, promises, flux).
    const record = (name: string, target: Record<string, unknown>) => {
      const orig = target[name] as (...a: unknown[]) => unknown;
      spies.push(
        jest.spyOn(target as never, name as never).mockImplementation(function (this: unknown, ...a: unknown[]) {
          for (const arg of a.slice(0, 2)) if (typeof arg === 'string') touched.push(path.resolve(arg));
          return orig.apply(this, a);
        } as never),
      );
    };
    for (const n of ['openSync', 'open', 'readFileSync', 'readFile', 'writeFileSync', 'writeFile', 'appendFileSync',
      'readdirSync', 'readdir', 'statSync', 'stat', 'lstatSync', 'existsSync', 'accessSync', 'mkdirSync',
      'copyFileSync', 'renameSync', 'createReadStream', 'createWriteStream', 'rmSync', 'unlinkSync']) {
      record(n, realFs as unknown as Record<string, unknown>);
    }
    for (const n of ['open', 'readFile', 'writeFile', 'appendFile', 'readdir', 'stat', 'access', 'mkdir', 'copyFile', 'rename', 'rm', 'unlink']) {
      record(n, realFs.promises as unknown as Record<string, unknown>);
    }

    app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalGuards(new PinGuard(app.get(require('@nestjs/config').ConfigService)), new DemoWriteGuard(app.get(RequestDataDirService)));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    spies.forEach((s) => s.mockRestore());
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(demoDir, { recursive: true, force: true });
  });

  it('sert la démo sans PIN, y compris en lecture de plusieurs écrans, sans toucher data-local/', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const supertest = require('supertest') as typeof import('supertest');
    const http = app.getHttpServer();
    await supertest(http).post('/api/demo/seed').expect(201);
    const status = await supertest(http).get('/api/demo/status').expect(200);
    expect(status.body).toMatchObject({ forced: true, seeded: true });
    for (const route of ['/api/statements', '/api/loans', '/api/savings', '/api/budgets', '/api/dashboard', '/api/subscriptions']) {
      const res = await supertest(http).get(route);
      expect(res.status).toBeLessThan(500);
      expect(res.status).not.toBe(401);
    }
    // Une écriture est refusée (démo en lecture seule), jamais redirigée vers les vraies données.
    const write = await supertest(http).put('/api/budgets').send({});
    expect(write.status).toBe(403);

    expect(touched.length).toBeGreaterThan(0);
    // Garde-fou du test : le jeu de démo a bien été lu/écrit dans DATA_DIR.
    expect(touched.some((p) => inside(p, path.join(demoDir, 'demo')))).toBe(true);
    const offenders = touched.filter((p) => FORBIDDEN.some((f) => inside(p, f)));
    expect(offenders).toEqual([]);
  });
});
