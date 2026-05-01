import { Controller, Post } from '@nestjs/common';
import { SnapshotService } from './snapshot.service';

@Controller('admin')
export class SnapshotController {
  constructor(private readonly snapshots: SnapshotService) {}

  @Post('snapshot')
  async takeManual() {
    const path = await this.snapshots.takeSnapshot('manual');
    return { path };
  }
}
