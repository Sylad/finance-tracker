import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class PinGuard implements CanActivate {
  private readonly pin: string;

  constructor(private config: ConfigService) {
    this.pin = config.get<string>('appPin') ?? '';
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();

    // Laisser passer le health check, le flux SSE et les routes demo publiques
    if (req.path === '/api/health' || req.path === '/api/events') return true;
    if (req.path.startsWith('/api/demo')) return true;

    const auth = req.headers['authorization'] ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

    if (!this.pin || token === this.pin) return true;

    throw new UnauthorizedException('PIN invalide');
  }
}
