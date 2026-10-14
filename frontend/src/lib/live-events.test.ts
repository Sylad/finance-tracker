import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { EVENT_QUERY_KEYS, startLiveEvents } from './live-events';

class FakeSource {
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  readyState = 1;
  closed = false;
  close() {
    this.closed = true;
  }
  push(payload: unknown) {
    this.onmessage?.({ data: typeof payload === 'string' ? payload : JSON.stringify(payload) });
  }
}

function setup() {
  const qc = new QueryClient();
  const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
  const src = new FakeSource();
  const stop = startLiveEvents(qc, () => src as unknown as EventSource);
  return { spy, src, stop };
}

describe('startLiveEvents', () => {
  it('invalide les requêtes liées à l’événement reçu', () => {
    const { spy, src } = setup();
    src.push({ type: 'goals-changed', data: null });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['goals'] });
  });

  it('couvre tous les événements émis par le backend', () => {
    for (const t of [
      'import-logs-changed', 'category-rule-suggestions-changed', 'goals-changed',
      'loans-changed', 'loan-suggestions-changed', 'declarations-changed',
      'savings-changed', 'category-rules-changed', 'accounts-synced', 'subscriptions-changed',
    ]) {
      expect(EVENT_QUERY_KEYS[t]?.length, t).toBeGreaterThan(0);
    }
  });

  it('échéances et abonnements invalident aussi les écrans qui les lisent (prévisions, santé)', () => {
    expect(EVENT_QUERY_KEYS['declarations-changed']).toEqual(expect.arrayContaining([['declarations'], ['forecast']]));
    expect(EVENT_QUERY_KEYS['subscriptions-changed']).toEqual(
      expect.arrayContaining([['subscriptions'], ['forecast'], ['health']]),
    );
  });

  it('ignore heartbeat, type inconnu et message illisible', () => {
    const { spy, src } = setup();
    src.push({ type: 'heartbeat', data: { ts: 1 } });
    src.push({ type: 'inconnu' });
    src.push('pas du json');
    expect(spy).not.toHaveBeenCalled();
  });

  it('ferme la connexion à l’arrêt', () => {
    const { src, stop } = setup();
    stop();
    expect(src.closed).toBe(true);
  });
});

describe('startLiveEvents — reconnexion', () => {
  afterEach(() => vi.useRealTimers());

  it('rouvre une connexion quand le navigateur abandonne (readyState CLOSED, ex. 502)', () => {
    vi.useFakeTimers();
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const sources: FakeSource[] = [];
    const open = () => {
      const s = new FakeSource();
      sources.push(s);
      return s as unknown as EventSource;
    };
    startLiveEvents(qc, open, { locks: undefined, createChannel: undefined });
    sources[0].readyState = 2;
    sources[0].onerror?.();
    expect(sources).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(sources).toHaveLength(2);
    sources[1].push({ type: 'goals-changed' });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['goals'] });
  });

  it('laisse EventSource se reconnecter seul tant qu’il est en CONNECTING', () => {
    vi.useFakeTimers();
    const qc = new QueryClient();
    const sources: FakeSource[] = [];
    startLiveEvents(
      qc,
      () => {
        const s = new FakeSource();
        sources.push(s);
        return s as unknown as EventSource;
      },
      { locks: undefined, createChannel: undefined },
    );
    sources[0].readyState = 0;
    sources[0].onerror?.();
    vi.advanceTimersByTime(60000);
    expect(sources).toHaveLength(1);
  });

  it('n’ouvre plus rien après l’arrêt', () => {
    vi.useFakeTimers();
    const qc = new QueryClient();
    const sources: FakeSource[] = [];
    const stop = startLiveEvents(
      qc,
      () => {
        const s = new FakeSource();
        sources.push(s);
        return s as unknown as EventSource;
      },
      { locks: undefined, createChannel: undefined },
    );
    sources[0].readyState = 2;
    sources[0].onerror?.();
    stop();
    vi.advanceTimersByTime(60000);
    expect(sources).toHaveLength(1);
  });
});

describe('startLiveEvents — une seule connexion pour tous les onglets', () => {
  // Faux Web Locks + faux BroadcastChannel partagés entre deux « onglets ».
  function world() {
    const held = new Map<string, boolean>();
    const waiting: Array<() => void> = [];
    const locks = {
      request(name: string, opts: { signal?: AbortSignal }, cb: () => Promise<void>) {
        const run = () => {
          held.set(name, true);
          return cb().then(() => {
            held.set(name, false);
            waiting.shift()?.();
          });
        };
        if (!held.get(name)) return run();
        return new Promise<void>((resolve) => {
          waiting.push(() => void run().then(resolve));
          opts.signal?.addEventListener('abort', () => resolve());
        });
      },
    };
    const channels: Array<{ onmessage: ((e: { data: unknown }) => void) | null }> = [];
    const createChannel = () => {
      const ch = {
        onmessage: null as ((e: { data: unknown }) => void) | null,
        postMessage(data: unknown) {
          for (const o of channels) if (o !== ch) o.onmessage?.({ data });
        },
        close() {},
      };
      channels.push(ch);
      return ch as unknown as BroadcastChannel;
    };
    return { locks: locks as unknown as LockManager, createChannel };
  }

  it('un seul onglet ouvre le flux et relaie les événements aux autres', async () => {
    const w = world();
    const opened: FakeSource[] = [];
    const open = () => {
      const s = new FakeSource();
      opened.push(s);
      return s as unknown as EventSource;
    };
    const qcA = new QueryClient();
    const qcB = new QueryClient();
    const spyA = vi.spyOn(qcA, 'invalidateQueries').mockResolvedValue();
    const spyB = vi.spyOn(qcB, 'invalidateQueries').mockResolvedValue();
    startLiveEvents(qcA, open, w);
    startLiveEvents(qcB, open, w);
    await Promise.resolve();
    expect(opened).toHaveLength(1);
    opened[0].push({ type: 'goals-changed' });
    expect(spyA).toHaveBeenCalledWith({ queryKey: ['goals'] });
    expect(spyB).toHaveBeenCalledWith({ queryKey: ['goals'] });
  });

  it('un autre onglet reprend le flux quand le titulaire se ferme', async () => {
    const w = world();
    const opened: FakeSource[] = [];
    const open = () => {
      const s = new FakeSource();
      opened.push(s);
      return s as unknown as EventSource;
    };
    const stopA = startLiveEvents(new QueryClient(), open, w);
    startLiveEvents(new QueryClient(), open, w);
    await Promise.resolve();
    stopA();
    await new Promise((r) => setTimeout(r, 0));
    expect(opened[0].closed).toBe(true);
    expect(opened).toHaveLength(2);
  });
});
