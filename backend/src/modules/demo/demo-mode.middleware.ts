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
    const headerValue = req.header('X-Demo-Mode');
    const demoMode = available && headerValue === 'true';
    this.dataDir.runWith({ demoMode }, () => next());
  }
}
