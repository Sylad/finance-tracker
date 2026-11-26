import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { Observable } from 'rxjs';

/**
 * Erreurs du parseur de corps (express.json / express.urlencoded) — L186.
 *
 * Sans ce module, une erreur du parseur (JSON mal formé, corps trop gros)
 * part dans la chaîne d'erreurs d'Express et y croise le gestionnaire posé
 * par `ServeStaticModule`, qui transforme TOUTE erreur sous `/api` en
 * 404 « Cannot POST … ». Le client voyait une route absente.
 *
 * Ordre des contrôles choisi : le parseur ne répond plus lui-même. Son erreur
 * est mise de côté sur la requête, la requête suit son cours (routage,
 * middlewares, gardes), et l'intercepteur global la lève juste après les
 * gardes, avant les pipes et le contrôleur. Conséquences :
 * - route inconnue → 404 (elle l'est vraiment) ;
 * - sans PIN → 401, comme toute requête non authentifiée : un client sans PIN
 *   n'apprend rien du traitement du corps (ni sa limite, ni l'erreur de
 *   parse), et le front garde un seul signal « PIN invalide » ;
 * - démo verrouillée → 403 sur une écriture, comme avant ;
 * - sinon → 400 (JSON invalide) ou 413 (au-delà de la limite).
 * Le corps n'est pas gardé en mémoire pour autant : body-parser s'arrête à la
 * limite (ou sur l'en-tête Content-Length) et jette le reste.
 */

/** Limite par défaut d'express.json, inchangée (surcharge : BODY_LIMIT). */
export const DEFAULT_BODY_LIMIT = '100kb';

/** Limite validée : octets pour body-parser, libellé pour les messages. */
export interface BodyLimit {
  bytes: number;
  label: string;
}

const UNITS: Record<string, number> = {
  '': 1,
  b: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
};

/**
 * Lit BODY_LIMIT au démarrage. Formats acceptés : un nombre d'octets entier
 * (`102400`) ou un nombre suivi de b, kb, mb ou gb, casse indifférente
 * (`100kb`, `2mb`, `1.5MB`) — base 1024, comme body-parser.
 * - absente, vide ou blanche → DEFAULT_BODY_LIMIT (une variable laissée vide
 *   dans un .env ou un values.yaml faisait planter body-parser) ;
 * - toute autre valeur (`2m`, `abc`, `0`, `-1kb`) → erreur au démarrage qui
 *   cite la valeur : `bytes` lit `2m` comme 2 octets, et un repli silencieux
 *   masquerait la faute de frappe ; on refuse, comme sans APP_PIN.
 */
export function parseBodyLimit(raw: string | undefined): BodyLimit {
  const value = (raw ?? '').trim();
  if (value === '') return parseBodyLimit(DEFAULT_BODY_LIMIT);
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(value);
  const unit = (m?.[2] ?? '').toLowerCase();
  const bytes = m ? Math.floor(Number(m[1]) * UNITS[unit]) : NaN;
  if (
    !Number.isFinite(bytes) ||
    bytes < 1 ||
    (unit === '' && m?.[1].includes('.'))
  ) {
    throw new Error(
      `BODY_LIMIT invalide : « ${raw} ». Formats acceptés : un nombre d'octets ` +
        `(102400) ou un nombre suivi de b, kb, mb ou gb (100kb, 2mb). ` +
        `Vide ou absente : ${DEFAULT_BODY_LIMIT}.`,
    );
  }
  return { bytes, label: value };
}

/** Nombre de champs d'un formulaire urlencoded (défaut de body-parser). */
export const PARAMETER_LIMIT = 1000;

const deferred = new WeakMap<Request, HttpException>();

interface BodyParserError {
  type: string;
  status: number;
}

function isBodyParserError(err: unknown): err is BodyParserError {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as Partial<BodyParserError>;
  // Tous les échecs de body-parser / raw-body portent un `type` pointé
  // (entity.parse.failed, entity.too.large, request.aborted, …) et un statut.
  return (
    typeof e.type === 'string' &&
    /^(entity|request|encoding|charset|parameters|stream)\./.test(e.type) &&
    typeof e.status === 'number'
  );
}

/** Traduit une erreur du parseur en réponse HTTP au message clair. */
export function toHttpException(
  err: BodyParserError,
  limit: string,
): HttpException {
  switch (err.type) {
    case 'entity.parse.failed':
      return new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: "Le corps de la requête n'est pas un JSON valide.",
        },
        HttpStatus.BAD_REQUEST,
      );
    case 'parameters.too.many':
      return new HttpException(
        {
          statusCode: 413,
          error: 'Payload Too Large',
          message: `Le formulaire contient trop de champs (${PARAMETER_LIMIT} au plus).`,
        },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    case 'entity.too.large':
      return new HttpException(
        {
          statusCode: 413,
          error: 'Payload Too Large',
          message: `Le corps de la requête dépasse la limite autorisée (${limit}).`,
        },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return new HttpException(
        {
          statusCode: 415,
          error: 'Unsupported Media Type',
          message:
            "L'encodage ou le jeu de caractères du corps n'est pas pris en charge.",
        },
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    default: {
      const status =
        err.status >= 400 && err.status < 600
          ? err.status
          : HttpStatus.BAD_REQUEST;
      return new HttpException(
        { statusCode: status, message: 'Corps de la requête illisible.' },
        status,
      );
    }
  }
}

/**
 * Remplace les parseurs par défaut de Nest (l'application doit être créée
 * avec `bodyParser: false`) par les mêmes parseurs, à la limite donnée, suivis
 * du middleware d'erreur qui met l'erreur de côté.
 */
export function registerBodyParsers(
  app: NestExpressApplication,
  limit: BodyLimit,
): void {
  app.useBodyParser('json', { limit: limit.bytes });
  app.useBodyParser('urlencoded', {
    extended: true,
    limit: limit.bytes,
    parameterLimit: PARAMETER_LIMIT,
  });
  app.use((err: unknown, req: Request, _res: Response, next: NextFunction) => {
    if (!isBodyParserError(err)) return next(err);
    deferred.set(req, toHttpException(err, limit.label));
    next();
  });
}

/** Lève l'erreur de parse mise de côté, après les gardes (PIN, démo). */
@Injectable()
export class BodyParserErrorInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const error = deferred.get(req);
    if (error) throw error;
    return next.handle();
  }
}
