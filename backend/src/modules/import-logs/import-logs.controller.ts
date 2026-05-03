import { Controller, Get } from '@nestjs/common';
import { ImportLogsService } from './import-logs.service';

@Controller('import-logs')
export class ImportLogsController {
  constructor(private readonly svc: ImportLogsService) {}

  @Get()
  list() { return this.svc.getAll(); }
}
