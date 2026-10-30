import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { EVENT_QUERY_KEYS, startLiveEvents, pageWillReload } from './live-events';

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

  it('épargne, crédits et relevés invalident aussi les objectifs (progression calculée dessus)', () => {
    for (const t of ['savings-changed', 'loans-changed', 'accounts-synced']) {
      expect(EVENT_QUERY_KEYS[t], t).toEqual(expect.arrayContaining([['goals']]));
    }
  });

  // Table de référence (cf. en-tête de live-events.ts) : pour chaque événement, la
  // liste COMPLÈTE des clés dont une source lue côté backend est modifiée.
  const EXPECTED: Record<string, string[]> = {
    'loans-changed': ['loans', 'dashboard', 'health', 'forecast', 'goals', 'expenses-breakdown'],
    'loan-suggestions-changed': ['loan-suggestions'],
    'savings-changed': ['savings', 'dashboard', 'health', 'goals', 'expenses-breakdown'],
    'goals-changed': ['goals'],
    'subscriptions-changed': ['subscriptions', 'forecast', 'health', 'expenses-breakdown'],
    'declarations-changed': ['declarations', 'forecast'],
    'category-rules-changed': ['category-rules'],
    'category-rule-suggestions-changed': ['category-rule-suggestions'],
    'import-logs-changed': ['import-logs'],
    'accounts-synced': [
      'statements', 'statement', 'loans', 'savings', 'subscriptions', 'loan-suggestions',
      'dashboard', 'health', 'forecast', 'expenses-breakdown', 'goals',
    ],
  };

  it('la table attendue couvre exactement les 10 événements du backend', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(Object.keys(EVENT_QUERY_KEYS).sort());
    expect(Object.keys(EXPECTED)).toHaveLength(10);
  });

  for (const [type, prefixes] of Object.entries(EXPECTED)) {
    it(`${type} invalide exactement ${prefixes.length} clé(s) : ${prefixes.join(', ')}`, () => {
      const { spy, src } = setup();
      src.push({ type, data: null });
      const called = spy.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey).sort();
      expect(called).toEqual(prefixes.map((p) => [p]).sort());
    });
  }

  it('dépenses : crédits, épargne et abonnements invalident le détail des dépenses (collectAllocatedTxIds)', () => {
    for (const t of ['loans-changed', 'savings-changed', 'subscriptions-changed', 'accounts-synced']) {
      expect(EVENT_QUERY_KEYS[t], t).toEqual(expect.arrayContaining([['expenses-breakdown']]));
    }
  });

  it('accounts-synced invalide aussi le préfixe singulier [statement] (anomalies d’un relevé)', () => {
    expect(EVENT_QUERY_KEYS['accounts-synced']).toEqual(
      expect.arrayContaining([['statements'], ['statement']]),
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

  const ALL_PREFIXES = [...new Set(Object.values(EVENT_QUERY_KEYS).flat().map((k) => k[0] as string))].sort();
  const invalidated = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]).sort();

  it('à la reconnexion après une erreur, invalide toutes les clés de EVENT_QUERY_KEYS (une seule fois chacune)', () => {
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
    sources[0].onopen?.();
    expect(spy).not.toHaveBeenCalled();
    sources[0].readyState = 2;
    sources[0].onerror?.();
    vi.advanceTimersByTime(1000);
    expect(spy).not.toHaveBeenCalled();
    sources[1].onopen?.();
    expect(invalidated(spy)).toEqual(ALL_PREFIXES);
    spy.mockClear();
    sources[1].onopen?.();
    expect(spy).not.toHaveBeenCalled();
  });

  it('reconnexion automatique du navigateur (CONNECTING puis open) : même rattrapage', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const src = new FakeSource();
    startLiveEvents(qc, () => src as unknown as EventSource, { locks: undefined, createChannel: undefined });
    src.onopen?.();
    src.readyState = 0;
    src.onerror?.();
    src.readyState = 1;
    src.onopen?.();
    expect(invalidated(spy)).toEqual(ALL_PREFIXES);
  });

  it('relaie le rattrapage aux autres onglets', () => {
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
    const qcA = new QueryClient();
    const qcB = new QueryClient();
    const spyA = vi.spyOn(qcA, 'invalidateQueries').mockResolvedValue();
    const spyB = vi.spyOn(qcB, 'invalidateQueries').mockResolvedValue();
    const src = new FakeSource();
    startLiveEvents(qcA, () => src as unknown as EventSource, { locks: undefined, createChannel });
    startLiveEvents(qcB, () => new FakeSource() as unknown as EventSource, { locks: undefined, createChannel });
    src.onopen?.();
    src.readyState = 0;
    src.onerror?.();
    src.onopen?.();
    expect(invalidated(spyA)).toEqual(ALL_PREFIXES);
    expect(invalidated(spyB)).toEqual(ALL_PREFIXES);
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

describe('pageWillReload (L71 — une seule réponse /api/events par page)', () => {
  it('R1 — démo forcée sans PIN : la page se recharge, le flux ne doit pas être ouvert avant', () => {
    expect(pageWillReload(true, false)).toBe(true);
  });
  it('R1 — démo forcée avec PIN factice (après rechargement) : flux autorisé', () => {
    expect(pageWillReload(true, true)).toBe(false);
  });
  it('R1 — hôte non forcé : aucun rechargement, flux autorisé, connecté ou non', () => {
    expect(pageWillReload(false, false)).toBe(false);
    expect(pageWillReload(false, true)).toBe(false);
  });
  it('R1 — statut de démo encore inconnu (null) : on attend, pas de flux', () => {
    expect(pageWillReload(null, false)).toBe(true);
    expect(pageWillReload(null, true)).toBe(true);
  });
});
