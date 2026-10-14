import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { EVENT_QUERY_KEYS, startLiveEvents } from './live-events';

class FakeSource {
  onmessage: ((e: { data: string }) => void) | null = null;
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
