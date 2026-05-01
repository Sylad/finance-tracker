import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

export interface AppEvent<T = unknown> {
  type: string;
  data?: T;
}

@Injectable()
export class EventBusService {
  private readonly subject$ = new Subject<AppEvent>();
  readonly events$ = this.subject$.asObservable();

  emit<T>(type: string, data?: T): void {
    this.subject$.next({ type, data });
  }
}
