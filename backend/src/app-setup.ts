import type { NestApplicationOptions } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PinGuard } from './guards/pin.guard';
import { DemoWriteGuard } from './guards/demo-write.guard';
import { RequestDataDirService } from './modules/demo/request-data-dir.service';
import {
  BodyParserErrorInterceptor,
  DEFAULT_BODY_LIMIT,
  registerBodyParsers,
} from './common/body-parser-errors';

/**
 * Options de création de l'application. `bodyParser: false` : les parseurs
 * sont posés par `configureApp` avec leur gestion d'erreur (L186).
 */
export const APP_OPTIONS: NestApplicationOptions = { bodyParser: false };

/**
 * Configuration commune à `main.ts` et aux tests e2e : préfixe, parseurs de
 * corps, gardes globales (PIN puis démo), intercepteur d'erreurs de parse, CORS.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');
  registerBodyParsers(
    app,
    config.get<string>('bodyLimit') ?? DEFAULT_BODY_LIMIT,
  );
  app.useGlobalGuards(
    new PinGuard(config),
    new DemoWriteGuard(app.get(RequestDataDirService)),
  );
  app.useGlobalInterceptors(new BodyParserErrorInterceptor());

  app.enableCors({
    origin: config.get<string>('corsOrigin'),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Accept', 'Authorization', 'X-Demo-Mode'],
  });
}
