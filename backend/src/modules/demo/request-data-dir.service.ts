import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AsyncLocalStorage } from 'async_hooks';
import * as path from 'path';

interface RequestContext {
  demoMode: boolean;
  forced: boolean;
}

@Injectable()
export class RequestDataDirService {
  private readonly als = new AsyncLocalStorage<RequestContext>();

  constructor(private readonly config: ConfigService) {}

  runWith<T>(ctx: RequestContext, fn: () => T): T {
    return this.als.run(ctx, fn);
  }

  isDemoMode(): boolean {
    return this.als.getStore()?.demoMode ?? false;
  }

  isForced(): boolean {
    return this.als.getStore()?.forced ?? false;
  }

  getDataDir(): string {
    const baseDir = this.config.get<string>('dataDir')!;
    return this.isDemoMode() ? path.join(baseDir, 'demo') : baseDir;
  }
}
