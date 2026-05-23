import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { RequestDataDirService } from '../modules/demo/request-data-dir.service';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class DemoWriteGuard implements CanActivate {
  constructor(private readonly dataDir: RequestDataDirService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!this.dataDir.isForced()) return true;
    if (!WRITE_METHODS.has(req.method.toUpperCase())) return true;

    // Forced public demo hosts need this one idempotent bootstrap endpoint
    // so an empty demo dataset can initialize itself without exposing real data.
    if (req.method.toUpperCase() === 'POST' && req.path === '/api/demo/seed') {
      return true;
    }

    throw new ForbiddenException('Mode démo verrouillé : écritures désactivées');
  }
}
