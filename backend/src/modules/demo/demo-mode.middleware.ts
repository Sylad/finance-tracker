import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';
import { RequestDataDirService } from './request-data-dir.service';
import { isForcedDemoRequest } from './forced-demo';

@Injectable()
export class DemoModeMiddleware implements NestMiddleware {
  constructor(
    private readonly dataDir: RequestDataDirService,
    private readonly config: ConfigService,
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    const available = this.config.get<boolean>('demoModeAvailable') ?? true;
    const forcedHosts = this.config.get<string[]>('demoForcedHosts') ?? [];
    const forcedAll = this.config.get<boolean>('demoForcedAll') ?? false;

    // Forced demo: Host only (never X-Forwarded-Host) or server-side flag —
    // see forced-demo.ts for why.
    const forced = isForcedDemoRequest(req, forcedHosts, forcedAll);

    const headerValue = req.header('X-Demo-Mode');
    const demoMode = forced || (available && headerValue === 'true');
    this.dataDir.runWith({ demoMode, forced }, () => next());
  }
}
