import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './app.module';
import { APP_OPTIONS, configureApp } from './app-setup';
import { ZodValidationPipe } from './common/zod-validation.pipe';

/**
 * L186 — erreurs du parseur de corps, de bout en bout (supertest).
 *
 * L'application est créée comme dans main.ts (NestFactory + configureApp) et
 * non par Test.createTestingModule : ce dernier n'a pas encore d'adaptateur
 * HTTP quand ServeStaticModule choisit son chargeur, si bien que le
 * gestionnaire d'erreurs de serve-static — celui qui changeait les erreurs du
 * parseur en 404 « Cannot PUT » — n'y est jamais monté et le défaut restait
 * invisible.
 */
const PIN = '4321';
const ENV_KEYS = [
  'APP_PIN',
  'DATA_DIR',
  'UPLOAD_DIR',
  'BODY_LIMIT',
  'DEMO_FORCED',
  'NODE_ENV',
] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};
let dataDir: string;
let app: NestExpressApplication;
let server: App;

const auth = { Authorization: `Bearer ${PIN}` };
const json = { 'Content-Type': 'application/json' };
// Au-delà de la limite par défaut (100kb = 102 400 octets).
const tooBig = JSON.stringify({
  alimentation: 1,
  note: 'x'.repeat(110 * 1024),
});
// Budget valide d'environ 2,5 Ko : passe à 100kb, refusé à 1kb.
const twoKb = Object.fromEntries(
  Array.from({ length: 100 }, (_, i) => [`poste-${i}`, i]),
);

/**
 * Application montée comme dans main.ts. `bodyLimit` : valeur de BODY_LIMIT
 * (undefined = variable absente).
 */
async function createApp(bodyLimit?: string): Promise<NestExpressApplication> {
  if (bodyLimit === undefined) delete process.env.BODY_LIMIT;
  else process.env.BODY_LIMIT = bodyLimit;
  const created = await NestFactory.create<NestExpressApplication>(AppModule, {
    ...APP_OPTIONS,
    logger: false,
  });
  try {
    configureApp(created);
  } catch (err) {
    await created.close();
    throw err;
  }
  await created.init();
  return created;
}

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-l186-'));
  process.env.APP_PIN = PIN;
  process.env.DATA_DIR = dataDir;
  process.env.UPLOAD_DIR = path.join(dataDir, 'uploads');
  process.env.NODE_ENV = 'test';
  delete process.env.DEMO_FORCED;

  app = await createApp();
  server = app.getHttpServer();
});

afterAll(async () => {
  await app?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('L186 — avec le PIN', () => {
  it('JSON mal formé → 400 avec un message clair', async () => {
    const res = await request(server)
      .put('/api/budgets')
      .set(json)
      .set(auth)
      .send('{alimentation: 10');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: "Le corps de la requête n'est pas un JSON valide.",
    });
  });

  it('corps au-delà de la limite → 413 qui nomme la limite', async () => {
    const res = await request(server)
      .put('/api/budgets')
      .set(json)
      .set(auth)
      .send(tooBig);
    expect(res.status).toBe(413);
    expect(res.body).toEqual({
      statusCode: 413,
      error: 'Payload Too Large',
      message: 'Le corps de la requête dépasse la limite autorisée (100kb).',
    });
  });

  it('sur un POST aussi (plus de 404 « Cannot POST »)', async () => {
    const res = await request(server)
      .post('/api/goals')
      .set(json)
      .set(auth)
      .send('{"name": ');
    expect(res.status).toBe(400);
    expect((res.body as { message: unknown }).message).toBe(
      "Le corps de la requête n'est pas un JSON valide.",
    );
  });

  it("l'erreur de parse n'atteint ni la validation ni le contrôleur : rien n'est écrit", async () => {
    const seeded = { alimentation: 200 };
    await request(server)
      .put('/api/budgets')
      .set(auth)
      .send(seeded)
      .expect(200);
    const transform = jest.spyOn(ZodValidationPipe.prototype, 'transform');
    try {
      const res = await request(server)
        .put('/api/budgets')
        .set(json)
        .set(auth)
        .send('{bad');
      expect(res.status).toBe(400);
      // Sans l'intercepteur, `req.body` (undefined) irait au pipe Zod, qui
      // répondrait lui aussi 400 : seul ce compteur distingue les deux.
      expect(transform).not.toHaveBeenCalled();
    } finally {
      transform.mockRestore();
    }
    const res = await request(server).get('/api/budgets').set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(seeded);
  });
});

describe('L186 — autres erreurs du parseur', () => {
  it('jeu de caractères non pris en charge → 415', async () => {
    const res = await request(server)
      .put('/api/budgets')
      .set(auth)
      .set('Content-Type', 'application/json; charset=latin1')
      .send('{"alimentation": 1}');
    expect(res.status).toBe(415);
    expect(res.body).toMatchObject({ error: 'Unsupported Media Type' });
  });

  it('formulaire de plus de 1000 champs → 413 qui le dit, sans parler de taille', async () => {
    const fields = Array.from({ length: 1001 }, (_, i) => `f${i}=1`).join('&');
    expect(Buffer.byteLength(fields)).toBeLessThan(100 * 1024);
    const res = await request(server)
      .post('/api/goals')
      .set(auth)
      .type('form')
      .send(fields);
    expect(res.status).toBe(413);
    expect((res.body as { message: unknown }).message).toBe(
      'Le formulaire contient trop de champs (1000 au plus).',
    );
  });
});

describe('L186 — démo verrouillée : 403 passe avant le contrôle du corps', () => {
  // Hôte de démo forcée par défaut (DEMO_FORCED_HOSTS = trycloudflare.com) :
  // la garde PIN laisse passer, DemoWriteGuard refuse l'écriture.
  const demoHost = { Host: 'essai.trycloudflare.com' };

  it('JSON mal formé → 403', async () => {
    const res = await request(server)
      .put('/api/budgets')
      .set(demoHost)
      .set(json)
      .send('{bad');
    expect(res.status).toBe(403);
  });

  it('corps trop gros → 403', async () => {
    const res = await request(server)
      .put('/api/budgets')
      .set(demoHost)
      .set(json)
      .send(tooBig);
    expect(res.status).toBe(403);
  });
});

describe('L186 — sans PIN : 401 passe avant le contrôle du corps', () => {
  it('JSON mal formé → 401', async () => {
    const res = await request(server)
      .put('/api/budgets')
      .set(json)
      .send('{bad');
    expect(res.status).toBe(401);
    expect((res.body as { message: unknown }).message).toBe('PIN invalide');
  });

  it('corps trop gros → 401', async () => {
    const res = await request(server)
      .put('/api/budgets')
      .set(json)
      .send(tooBig);
    expect(res.status).toBe(401);
  });
});

describe('L186 — BODY_LIMIT', () => {
  it('la limite par défaut (100kb) laisse passer un budget de 2,5 Ko', async () => {
    await request(server).put('/api/budgets').set(auth).send(twoKb).expect(200);
  });

  it('BODY_LIMIT=1kb : le même budget → 413 qui nomme 1kb', async () => {
    const small = await createApp('1kb');
    try {
      const res = await request(small.getHttpServer())
        .put('/api/budgets')
        .set(auth)
        .send(twoKb);
      expect(res.status).toBe(413);
      expect((res.body as { message: unknown }).message).toBe(
        'Le corps de la requête dépasse la limite autorisée (1kb).',
      );
    } finally {
      await small.close();
    }
  });

  it('BODY_LIMIT vide : démarre, repli sur 100kb', async () => {
    const empty = await createApp('');
    try {
      const http = empty.getHttpServer();
      await request(http).put('/api/budgets').set(auth).send(twoKb).expect(200);
      const res = await request(http)
        .put('/api/budgets')
        .set(json)
        .set(auth)
        .send(tooBig);
      expect(res.status).toBe(413);
      expect((res.body as { message: unknown }).message).toBe(
        'Le corps de la requête dépasse la limite autorisée (100kb).',
      );
    } finally {
      await empty.close();
    }
  });

  it('BODY_LIMIT=2m (2 octets pour body-parser) : refus de démarrer', async () => {
    await expect(createApp('2m')).rejects.toThrow(
      'BODY_LIMIT invalide : « 2m »',
    );
  });
});

describe('L186 — inchangé', () => {
  it('cas nominal : un JSON valide est lu, validé et enregistré', async () => {
    const put = await request(server)
      .put('/api/budgets')
      .set(json)
      .set(auth)
      .send({ alimentation: 350, loisirs: 80 });
    expect(put.status).toBe(200);
    const get = await request(server).get('/api/budgets').set(auth);
    expect(get.body).toEqual({ alimentation: 350, loisirs: 80 });
  });

  it('JSON valide mais refusé par le schéma → 400 de validation, comme avant', async () => {
    const res = await request(server)
      .put('/api/budgets')
      .set(json)
      .set(auth)
      .send({ alimentation: -1 });
    expect(res.status).toBe(400);
    expect((res.body as { message: unknown }).message).not.toBe(
      "Le corps de la requête n'est pas un JSON valide.",
    );
  });

  it('route inconnue → 404, même avec un corps invalide', async () => {
    const res = await request(server)
      .post('/api/inexistante')
      .set(json)
      .set(auth)
      .send('{bad');
    expect(res.status).toBe(404);
  });

  it('formulaire urlencoded toujours lu', async () => {
    const res = await request(server)
      .post('/api/goals')
      .set(auth)
      .type('form')
      .send('name=Vacances&type=savings_total&targetAmount=1000');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Vacances',
      type: 'savings_total',
      targetAmount: 1000,
    });
  });
});
