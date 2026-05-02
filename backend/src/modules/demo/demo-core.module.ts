import { Module, Global } from '@nestjs/common';
import { RequestDataDirService } from './request-data-dir.service';

@Global()
@Module({
  providers: [RequestDataDirService],
  exports: [RequestDataDirService],
})
export class DemoCoreModule {}
