import { describe, expect, it } from 'vitest';
import { dashboardView } from './dashboard-view';

type Q = Parameters<typeof dashboardView>[0];
const q = (over: Partial<Q>): Q => ({ isPending: false, isError: false, fetchStatus: 'idle', data: undefined, ...over });

describe('dashboardView (L21/t4)', () => {
  it('chargement', () => {
    expect(dashboardView(q({ isPending: true, fetchStatus: 'fetching' }))).toBe('loading');
  });
  it('requête en pause hors ligne (isLoading faux) : état hors ligne, jamais l’état vide', () => {
    expect(dashboardView(q({ isPending: true, fetchStatus: 'paused' }))).toBe('offline');
  });
  it("erreur de l'API : état d'erreur, jamais l'état vide", () => {
    expect(dashboardView(q({ isError: true }))).toBe('error');
  });
  it('erreur de rafraîchissement avec des données déjà en cache : on garde les données', () => {
    expect(dashboardView(q({ isError: true, data: [{}] }))).toBe('ready');
  });
  it('hors ligne avec des données en cache : on garde les données', () => {
    expect(dashboardView(q({ fetchStatus: 'paused', data: [{}] }))).toBe('ready');
  });
  it('aucun relevé : état vide', () => {
    expect(dashboardView(q({ data: [] }))).toBe('empty');
  });
  it('des relevés : prêt', () => {
    expect(dashboardView(q({ data: [{}] }))).toBe('ready');
  });
});
