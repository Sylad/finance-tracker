import { describe, it, expect } from 'vitest';
import { recognizeMerchant } from './merchants';

describe('recognizeMerchant', () => {
  it('reconnaît le marchand (nom + domaine)', () => {
    expect(recognizeMerchant('PRLV EDF CLIENTS')).toMatchObject({ name: 'EDF', domain: 'edf.fr' });
    expect(recognizeMerchant('PREDICA ASSURANCE')).toMatchObject({ name: 'Predica' });
  });

  it('ne produit aucune URL tierce (pas de requête réseau vers un CDN d\'icônes)', () => {
    const hit = recognizeMerchant('NETFLIX.COM');
    expect(hit).not.toBeNull();
    expect(JSON.stringify(hit)).not.toMatch(/https?:\/\//);
    expect(hit).not.toHaveProperty('faviconUrl');
  });

  it('renvoie null pour un libellé inconnu ou vide', () => {
    expect(recognizeMerchant('')).toBeNull();
    expect(recognizeMerchant('VIREMENT DUPONT')).toBeNull();
  });
});
