import { Module } from '@nestjs/common';
import { ImportLogsController } from './import-logs.controller';
import { ImportLogsService } from './import-logs.service';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [EventsModule],
  controllers: [ImportLogsController],
  providers: [ImportLogsService],
  exports: [ImportLogsService],
})
export class ImportLogsModule {}
