import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { RequestDataDirService } from '../demo/request-data-dir.service';

const MAX_SNAPSHOTS = 30;
// Excluded from snapshots: `snapshots/` to avoid recursion, `uploads/` because
// PDFs are deleted right after analysis (transient) and could be voluminous.
const EXCLUDED = new Set(['snapshots', 'uploads']);

@Injectable()
export class SnapshotService implements OnModuleInit {
  private readonly logger = new Logger(SnapshotService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly requestDataDir: RequestDataDirService,
  ) {}

  onModuleInit() {
    // Ensure snapshots dir exists for both normal and demo locations.
    const real = this.config.get<string>('dataDir')!;
    for (const root of [real, path.join(real, 'demo')]) {
      fs.mkdirSync(path.join(root, 'snapshots'), { recursive: true });
    }
  }

  private get dataDir(): string {
    return path.resolve(this.requestDataDir.getDataDir());
  }

  private get snapshotsDir(): string {
    return path.join(this.dataDir, 'snapshots');
  }

  async takeSnapshot(reason: string): Promise<string> {
    const safeReason = reason.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40) || 'unspecified';
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const target = path.join(this.snapshotsDir, `${ts}_${safeReason}`);

    await fs.promises.mkdir(target, { recursive: true });

    const entries = await fs.promises.readdir(this.dataDir, { withFileTypes: true });
    for (const entry of entries) {
      if (EXCLUDED.has(entry.name)) continue;
      const src = path.join(this.dataDir, entry.name);
      const dst = path.join(target, entry.name);
      await this.copyRecursive(src, dst);
    }

    this.logger.log(`Snapshot created: ${target} (reason=${reason})`);
    await this.rotate();
    return target;
  }

  private async copyRecursive(src: string, dst: string): Promise<void> {
    const stat = await fs.promises.stat(src);
    if (stat.isDirectory()) {
      await fs.promises.mkdir(dst, { recursive: true });
      const entries = await fs.promises.readdir(src);
      for (const name of entries) {
        await this.copyRecursive(path.join(src, name), path.join(dst, name));
      }
    } else if (stat.isFile()) {
      await fs.promises.copyFile(src, dst);
    }
  }

  private async rotate(): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(this.snapshotsDir, { withFileTypes: true });
    } catch {
      return;
    }
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    if (dirs.length <= MAX_SNAPSHOTS) return;
    const toDelete = dirs.slice(0, dirs.length - MAX_SNAPSHOTS);
    for (const name of toDelete) {
      const full = path.join(this.snapshotsDir, name);
      try {
        await fs.promises.rm(full, { recursive: true, force: true });
        this.logger.log(`Rotated old snapshot: ${name}`);
      } catch (e) {
        this.logger.warn(`Failed to rotate ${name}: ${(e as Error).message}`);
      }
    }
  }
}
