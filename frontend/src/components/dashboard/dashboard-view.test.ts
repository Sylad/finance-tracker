import { describe, expect, it } from 'vitest';
import { dashboardView } from './dashboard-view';

describe('dashboardView (L21/t4)', () => {
  it('chargement', () => {
    expect(dashboardView({ isLoading: true, isError: false, data: undefined })).toBe('loading');
  });
  it("erreur de l'API : état d'erreur, jamais l'état vide", () => {
    expect(dashboardView({ isLoading: false, isError: true, data: undefined })).toBe('error');
  });
  it('erreur de rafraîchissement avec des données déjà en cache : on garde les données', () => {
    expect(dashboardView({ isLoading: false, isError: true, data: [{}] })).toBe('ready');
  });
  it('aucun relevé : état vide', () => {
    expect(dashboardView({ isLoading: false, isError: false, data: [] })).toBe('empty');
  });
  it('des relevés : prêt', () => {
    expect(dashboardView({ isLoading: false, isError: false, data: [{}] })).toBe('ready');
  });
});
