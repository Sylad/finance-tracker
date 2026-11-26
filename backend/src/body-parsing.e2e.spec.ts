import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './app.module';
import { APP_OPTIONS, configureApp } from './app-setup';

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

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-l186-'));
  process.env.APP_PIN = PIN;
  process.env.DATA_DIR = dataDir;
  process.env.UPLOAD_DIR = path.join(dataDir, 'uploads');
  process.env.NODE_ENV = 'test';
  delete process.env.BODY_LIMIT;
  delete process.env.DEMO_FORCED;

  app = await NestFactory.create<NestExpressApplication>(AppModule, {
    ...APP_OPTIONS,
    logger: false,
  });
  configureApp(app);
  await app.init();
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

  it("l'erreur de parse n'atteint pas le contrôleur : rien n'est écrit", async () => {
    await request(server).put('/api/budgets').set(json).set(auth).send('{bad');
    const res = await request(server).get('/api/budgets').set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
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
