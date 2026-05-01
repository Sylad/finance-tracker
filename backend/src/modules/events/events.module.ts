import { Global, Module } from '@nestjs/common';
import { EventBusService } from './event-bus.service';
import { EventsController } from './events.controller';

@Global()
@Module({
  controllers: [EventsController],
  providers: [EventBusService],
  exports: [EventBusService],
})
export class EventsModule {}
