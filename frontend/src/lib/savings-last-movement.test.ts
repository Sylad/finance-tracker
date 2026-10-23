import { describe, expect, it } from 'vitest';
import { lastMovement } from './savings-last-movement';
import type { SavingsMovement } from '@/types/api';

const mv = (o: Partial<SavingsMovement>): SavingsMovement => ({
  id: 'm', date: '2026-09-30', amount: 0, source: 'detected', statementId: null, transactionId: null, ...o,
});

describe('lastMovement (L120)', () => {
  it('R1 — un ajustement au relevé est nommé et daté : « Ajustement au relevé · 30/09 : −200,00 € »', () => {
    const r = lastMovement([mv({ source: 'initial', date: '2026-01-01', amount: 6800 }), mv({ source: 'bank-extract', amount: -200 })]);
    expect(r?.text.replace(/\s/g, ' ')).toBe('Ajustement au relevé · 30/09 : −200,00 €');
  });

  it("R2 — la nature suit la source : versement détecté, intérêts, mouvement manuel", () => {
    expect(lastMovement([mv({ source: 'detected', amount: 50 })])?.text).toMatch(/^Versement détecté · 30\/09 : \+50,00/);
    expect(lastMovement([mv({ source: 'interest', amount: 12.5 })])?.text).toMatch(/^Intérêts · 30\/09 : \+12,50/);
    expect(lastMovement([mv({ source: 'manual', amount: -30 })])?.text).toMatch(/^Mouvement manuel · 30\/09 : −30,00/);
  });

  it("R3 — le dernier mouvement est le plus récent par date, pas le dernier du tableau", () => {
    const r = lastMovement([mv({ id: 'b', date: '2026-09-30', amount: 10 }), mv({ id: 'a', date: '2026-03-02', amount: 99 })]);
    expect(r?.text).toMatch(/30\/09/);
  });

  it("R4 — le solde initial n'est pas un mouvement ; sans mouvement ou à 0 €, rien n'est affiché", () => {
    expect(lastMovement([mv({ source: 'initial', amount: 6800 })])).toBeNull();
    expect(lastMovement([])).toBeNull();
    expect(lastMovement([mv({ amount: 0 })])).toBeNull();
  });

  it("R5 — un ajustement au relevé n'est pas coloré comme une perte ; un versement est positif, un retrait négatif", () => {
    expect(lastMovement([mv({ source: 'bank-extract', amount: -200 })])?.tone).toBe('neutral');
    expect(lastMovement([mv({ source: 'detected', amount: 50 })])?.tone).toBe('positive');
    expect(lastMovement([mv({ source: 'manual', amount: -50 })])?.tone).toBe('negative');
  });
});
