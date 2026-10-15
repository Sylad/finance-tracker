import { describe, expect, it } from 'vitest';
import { categorizationQuality, merchantLabel } from './categorization-quality';
import type { Transaction } from '@/types/api';

let n = 0;
const tx = (description: string, amount: number, category: Transaction['category'] = 'other'): Transaction => ({
  id: `t${n++}`, date: '2026-09-10', description, normalizedDescription: description, amount,
  currency: 'EUR', category, subcategory: '', isRecurring: false, confidence: 0.9,
});

describe('merchantLabel (L74)', () => {
  it('retire le préfixe bancaire, les dates et les numéros', () => {
    expect(merchantLabel('PAIEMENT CB 1209 BOULANGERIE DUPONT 12/09 PARIS')).toBe('BOULANGERIE DUPONT PARIS');
    expect(merchantLabel('PRLV SEPA MUTUELLE XYZ 0001234567')).toBe('MUTUELLE XYZ');
  });
  it('retire le préfixe PRELEVT de La Banque Postale et le « N° » devant le numéro', () => {
    expect(merchantLabel('PRELEVT BPCE ASSURANCES IARD')).toBe('BPCE ASSURANCES IARD');
    expect(merchantLabel('PRELEVT X PLV N° 51215116521100')).toBe('X PLV');
  });
  it('utilise le nom du marchand reconnu quand il existe', () => {
    expect(merchantLabel('PAYL*AMAZON EU 25/03 LUXEMBO')).toBe('Amazon');
  });
});

describe('categorizationQuality (L74)', () => {
  it('relevé vide : taux nul, aucun marchand', () => {
    expect(categorizationQuality([])).toEqual({ total: 0, otherCount: 0, rate: 0, topMerchants: [] });
  });

  it('taux = part des transactions classées « other »', () => {
    const q = categorizationQuality([
      tx('A', -10), tx('B', -10, 'food'), tx('C', -10, 'food'), tx('D', -10, 'transport'),
    ]);
    expect(q.total).toBe(4);
    expect(q.otherCount).toBe(1);
    expect(q.rate).toBeCloseTo(0.25);
  });

  it('regroupe les marchands non catégorisés par fréquence puis par montant', () => {
    const q = categorizationQuality([
      tx('CB PHARMACIE MARTIN 01/09', -12.5),
      tx('CB PHARMACIE MARTIN 15/09', -7.5),
      tx('CB TABAC LA GARE 03/09', -30),
      tx('CB TABAC LA GARE 04/09', -5),
      tx('CB COIFFEUR LUC 05/09', -40),
      tx('CB CARREFOUR 06/09', -50, 'food'),
    ]);
    expect(q.topMerchants).toEqual([
      { label: 'TABAC LA GARE', count: 2, total: 35 },
      { label: 'PHARMACIE MARTIN', count: 2, total: 20 },
      { label: 'COIFFEUR LUC', count: 1, total: 40 },
    ]);
  });

  it('limite la liste (5 par défaut) et ignore les crédits dans les marchands', () => {
    const many = Array.from({ length: 8 }, (_, i) => tx(`MARCHAND${String.fromCharCode(65 + i)}`, -1));
    expect(categorizationQuality(many).topMerchants).toHaveLength(5);
    expect(categorizationQuality(many, 3).topMerchants).toHaveLength(3);
    const q = categorizationQuality([tx('VIR DUPONT JEAN', 100)]);
    expect(q.otherCount).toBe(1);
    expect(q.topMerchants).toEqual([]);
  });
});
