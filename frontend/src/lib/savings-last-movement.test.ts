import { describe, expect, it } from 'vitest';
import { lastMovement, movementRows } from './savings-last-movement';
import type { SavingsMovement } from '@/types/api';

const mv = (o: Partial<SavingsMovement>): SavingsMovement => ({
  id: 'm', date: '2026-09-30', amount: 0, source: 'detected', statementId: null, transactionId: null, ...o,
});

describe('lastMovement (L120)', () => {
  it('R1 — un ajustement au relevé est nommé et daté : « Ajustement au relevé · 30/09 : −200,00 € »', () => {
    const r = lastMovement([mv({ source: 'initial', date: '2026-01-01', amount: 6800 }), mv({ source: 'bank-extract', amount: -200 })]);
    expect(r?.text.replace(/\s/g, ' ')).toBe('Ajustement au relevé · 30/09 : −200,00 €');
  });

  it("R2 — la nature suit la source et le signe : versement ou retrait détecté, intérêts, mouvement manuel", () => {
    expect(lastMovement([mv({ source: 'detected', amount: 50 })])?.text).toMatch(/^Versement détecté · 30\/09 : \+50,00/);
    expect(lastMovement([mv({ source: 'detected', amount: -50 })])?.text).toMatch(/^Retrait détecté · 30\/09 : −50,00/);
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

describe('movementRows (L123)', () => {
  it('R1 — la liste va du plus récent au plus ancien, solde initial compris, à date égale le dernier du tableau d\'abord', () => {
    const rows = movementRows([
      mv({ id: 'i', source: 'initial', date: '2026-01-01', amount: 6800 }),
      mv({ id: 'a', date: '2026-03-02', amount: 99 }),
      mv({ id: 'b', date: '2026-09-30', amount: 10 }),
      mv({ id: 'c', date: '2026-09-30', amount: 20 }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['c', 'b', 'a', 'i']);
  });

  it('R2 — chaque ligne porte la date jj/mm/aaaa, la nature de la carte (dont Solde initial et Retrait détecté), le montant signé en « − » et la note', () => {
    const rows = movementRows([
      mv({ id: 'i', source: 'initial', date: '2026-01-01', amount: 6800 }),
      mv({ id: 'r', source: 'detected', date: '2026-02-10', amount: -50, note: 'Virement LDDS' }),
      mv({ id: 'x', source: 'bank-extract', date: '2026-09-30', amount: -200 }),
    ]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.i).toMatchObject({ date: '01/01/2026', nature: 'Solde initial' });
    expect(byId.r).toMatchObject({ date: '10/02/2026', nature: 'Retrait détecté', note: 'Virement LDDS' });
    expect(byId.r.amount.replace(/\s/g, ' ')).toBe('−50,00 €');
    expect(byId.x).toMatchObject({ nature: 'Ajustement au relevé', tone: 'neutral' });
    expect(byId.x.note).toBeUndefined();
  });

  it('R4 — la ligne du solde initial ne répète pas sa nature dans une note', () => {
    const rows = movementRows([mv({ id: 'i', source: 'initial', date: '2026-01-01', amount: 6800, note: 'Solde initial déclaré' })]);
    expect(rows[0].note).toBeUndefined();
  });

  it("L126 R1 — la note d'un versement détecté perd son préfixe technique « Auto: »", () => {
    const rows = movementRows([mv({ id: 'd', source: 'detected', amount: 50, note: 'Auto: VIR LDDS MARS' })]);
    expect(rows[0].note).toBe('VIR LDDS MARS');
  });

  it("L126 R2 — la note d'intérêts ne répète pas la nature et écrit le taux en français : « 2026 (2,50 %) »", () => {
    const rows = movementRows([mv({ id: 'n', source: 'interest', amount: 12.5, note: 'Intérêts 2026 (2.50%)' })]);
    expect(rows[0].nature).toBe('Intérêts');
    expect(rows[0].note?.replace(/\s/g, ' ')).toBe('2026 (2,50 %)');
  });

  it("L128 R1 — un versement détecté noté « Auto: Intérêts créditeurs LDDS » garde sa note entière, « Intérêts » compris", () => {
    const rows = movementRows([mv({ id: 'd', source: 'detected', amount: 50, note: 'Auto: Intérêts créditeurs LDDS' })]);
    expect(rows[0].note).toBe('Intérêts créditeurs LDDS');
  });

  it("L128 R2 — le taux « 2.50% » n'est converti en français que pour les intérêts, pas dans la note d'un autre mouvement", () => {
    const rows = movementRows([
      mv({ id: 'm', source: 'manual', amount: 5, note: 'Réf 12.5% promo' }),
      mv({ id: 'n', source: 'interest', date: '2026-09-30', amount: 12.5, note: 'Intérêts 2026 (2.50%)' }),
    ]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.m.note).toBe('Réf 12.5% promo');
    expect(byId.n.note?.replace(/\s/g, ' ')).toBe('2026 (2,50 %)');
  });

  it("L126 R3 — la note du recalage « Solde recalibré depuis le relevé » répète la nature et n'est pas affichée ; une note propre est gardée", () => {
    const rows = movementRows([
      mv({ id: 'x', source: 'bank-extract', amount: -200, note: 'Solde recalibré depuis le relevé' }),
      mv({ id: 'y', source: 'bank-extract', date: '2026-08-31', amount: 5, note: 'Écart de 5 € constaté' }),
      mv({ id: 'z', source: 'manual', date: '2026-07-01', amount: 5, note: 'Auto: ' }),
    ]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.x.note).toBeUndefined();
    expect(byId.y.note).toBe('Écart de 5 € constaté');
    expect(byId.z.note).toBeUndefined();
  });

  it("L129 R1 — la redite en tête d'une note d'ajustement est retirée, le reste utile est gardé et ses nombres sont à la française", () => {
    const rows = movementRows([
      mv({ id: 'a', source: 'bank-extract', date: '2026-09-30', amount: -50, note: 'Ajustement solde réel depuis relevé (6750 vs 6800 calculé)' }),
      mv({ id: 'b', source: 'bank-extract', date: '2026-08-31', amount: 5, note: 'Solde recalibré depuis le relevé — écart dû aux intérêts capitalisés' }),
      mv({ id: 'c', source: 'bank-extract', date: '2026-07-31', amount: 5, note: 'Ajustement solde réel depuis relevé (1250.5 vs 1200 calculé)' }),
    ]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.a.note?.replace(/\s/g, ' ')).toBe('6 750 vs 6 800 calculé');
    expect(byId.b.note).toBe('Écart dû aux intérêts capitalisés');
    expect(byId.c.note?.replace(/\s/g, ' ')).toBe('1 250,5 vs 1 200 calculé');
    const annee = movementRows([mv({ source: 'bank-extract', note: 'Écart constaté en 2026' })]);
    expect(annee[0].note).toBe('Écart constaté en 2026');
  });

  it("L129 R2 — la redite n'est retirée que des ajustements au relevé : une note de même début sur un mouvement manuel reste intacte", () => {
    const rows = movementRows([mv({ id: 'm', source: 'manual', amount: 5, note: 'Solde recalibré depuis le relevé — à la main' })]);
    expect(rows[0].note).toBe('Solde recalibré depuis le relevé — à la main');
  });

  it('R3 — aucun mouvement : liste vide', () => {
    expect(movementRows([])).toEqual([]);
  });
});
