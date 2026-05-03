import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class PinGuard implements CanActivate {
  private readonly pin: string;
  private readonly forcedHosts: string[];

  constructor(private config: ConfigService) {
    this.pin = config.get<string>('appPin') ?? '';
    this.forcedHosts = config.get<string[]>('demoForcedHosts') ?? [];
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();

    // Laisser passer le health check, le flux SSE et les routes demo publiques
    if (req.path === '/api/health' || req.path === '/api/events') return true;
    if (req.path.startsWith('/api/demo')) return true;

    // Bypass PIN entirely on forced-demo hosts (Cloudflare quick tunnels, etc.).
    // The visitor is locked into demo data anyway, so requiring a PIN would only
    // block them from seeing the showcase.
    const hostHeader = ((req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host ?? '').toLowerCase();
    if (this.forcedHosts.some((p) => p && hostHeader.includes(p.toLowerCase()))) return true;

    const auth = req.headers['authorization'] ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

    if (!this.pin || token === this.pin) return true;

    throw new UnauthorizedException('PIN invalide');
  }
}
