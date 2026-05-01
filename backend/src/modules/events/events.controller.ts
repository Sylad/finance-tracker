import { Controller, Sse, MessageEvent } from '@nestjs/common';
import { Observable, interval, map, merge } from 'rxjs';
import { EventBusService } from './event-bus.service';

@Controller('events')
export class EventsController {
  constructor(private readonly bus: EventBusService) {}

  @Sse()
  stream(): Observable<MessageEvent> {
    const events$ = this.bus.events$.pipe(
      map((e) => ({ data: { type: e.type, data: e.data ?? null } } as MessageEvent)),
    );
    const heartbeat$ = interval(30_000).pipe(
      map(() => ({ data: { type: 'heartbeat', data: { ts: Date.now() } } } as MessageEvent)),
    );
    return merge(events$, heartbeat$);
  }
}
