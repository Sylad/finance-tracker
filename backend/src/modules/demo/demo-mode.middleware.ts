import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';
import { RequestDataDirService } from './request-data-dir.service';

@Injectable()
export class DemoModeMiddleware implements NestMiddleware {
  constructor(
    private readonly dataDir: RequestDataDirService,
    private readonly config: ConfigService,
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    const available = this.config.get<boolean>('demoModeAvailable') ?? true;
    const forcedHosts = this.config.get<string[]>('demoForcedHosts') ?? [];

    // Forced demo mode based on host (e.g. cloudflare quick tunnel).
    // Check both the Host header and the X-Forwarded-Host (set by reverse proxies).
    const hostHeader = (req.header('x-forwarded-host') ?? req.header('host') ?? '').toLowerCase();
    const forced = forcedHosts.some((pattern) => pattern && hostHeader.includes(pattern.toLowerCase()));

    const headerValue = req.header('X-Demo-Mode');
    const demoMode = forced || (available && headerValue === 'true');
    this.dataDir.runWith({ demoMode, forced }, () => next());
  }
}
