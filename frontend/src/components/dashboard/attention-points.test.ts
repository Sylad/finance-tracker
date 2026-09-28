import { describe, expect, it } from 'vitest';
import { humanizeCause, attentionPoints } from './attention-points';
import type { HealthDiagnostic } from '@/types/api';

const norm = (s: string) => s.replace(/[  ]/g, ' ');
const h = (raw: string) => {
  const r = humanizeCause(raw);
  return { ...r, text: norm(r.text) };
};

describe('humanizeCause (L21/t6)', () => {
  it('reste à vivre en % du revenu', () => {
    expect(h('orange car reste à vivre 5.7 % du revenu < 10 %'))
      .toEqual({ status: 'orange', text: 'Reste à vivre : 5,7 % du revenu (seuil 10 %)' });
  });
  it('reste à vivre négatif', () => {
    expect(h('rouge car reste à vivre -120.5 € < 0 €'))
      .toEqual({ status: 'red', text: 'Reste à vivre négatif : -120,50 €' });
  });
  it("taux d'effort", () => {
    expect(h("rouge car taux d'effort 70.5 % > 50 %"))
      .toEqual({ status: 'red', text: "Taux d'effort : 70,5 % des revenus (seuil 50 %)" });
    expect(h("orange car taux d'effort 33 % ≥ 33 %"))
      .toEqual({ status: 'orange', text: "Taux d'effort : 33 % des revenus (seuil 33 %)" });
  });
  it('plafond de réserve', () => {
    expect(h('orange car COFIDIS (186.00 €/mois · …1100) utilisé à 62.4 % ≥ 60 %'))
      .toEqual({ status: 'orange', text: 'COFIDIS (186.00 €/mois · …1100) utilisé à 62,4 % du plafond (seuil 60 %)' });
  });
  it('flux de tirages', () => {
    expect(h('rouge car flux tirages 600 €/mois > 15 % du revenu (420 €)'))
      .toEqual({ status: 'red', text: 'Tirages : 600,00 €/mois, plus de 15 % du revenu (420,00 €)' });
    expect(h('orange car tirages (300 €/mois) > remboursements (200.5 €/mois)'))
      .toEqual({ status: 'orange', text: 'Tirages (300,00 €/mois) supérieurs aux remboursements (200,50 €/mois)' });
  });
  it('trajectoire', () => {
    expect(h("orange car l'encours projeté reste stable (± 5 %) sous 6 mois"))
      .toEqual({ status: 'orange', text: 'Encours des réserves stable sur 6 mois (± 5 %) : pas de désendettement' });
    expect(h('rouge car le solde mensuel moyen est structurellement négatif (-39.21 €)'))
      .toEqual({ status: 'red', text: 'Solde mensuel moyen négatif : -39,21 €' });
    expect(h('rouge car l\'encours projeté de SOFINCO atteint le plafond sous 6 mois'))
      .toEqual({ status: 'red', text: 'Encours projeté de SOFINCO au plafond sous 6 mois' });
  });
  it('phrase inconnue : préfixe retiré, majuscule, décimales fr-FR', () => {
    expect(h('orange car quelque chose à 12.5 %'))
      .toEqual({ status: 'orange', text: 'Quelque chose à 12,5 %' });
    expect(h('revenus non configurés — diagnostic impossible'))
      .toEqual({ status: 'orange', text: 'Revenus non configurés — diagnostic impossible' });
  });
});

function diag(over: Partial<HealthDiagnostic['blocks']>): HealthDiagnostic {
  const green = { status: 'green' as const, thresholdHit: null, details: {} };
  return {
    verdict: 'red',
    causes: [],
    blocks: { resteAVivre: green, chargeDette: green, fluxTirages: green, trajectoire: green, ...over },
    income: { monthly: 2800, source: 'detected', label: null },
    reliability: 'ok',
    computedAt: '2026-09-28T00:00:00Z',
  };
}

describe('attentionPoints', () => {
  it('liste chaque cause avec SA couleur, les rouges en premier', () => {
    const pts = attentionPoints(diag({
      resteAVivre: { status: 'orange', thresholdHit: 'orange car reste à vivre 5.7 % du revenu < 10 %', details: {} },
      chargeDette: { status: 'red', thresholdHit: "rouge car taux d'effort 70.5 % > 50 % ; orange car COFIDIS utilisé à 62 % ≥ 60 %", details: {} },
    }));
    expect(pts.map((p) => p.status)).toEqual(['red', 'orange', 'orange']);
    expect(norm(pts[0].text)).toBe("Taux d'effort : 70,5 % des revenus (seuil 50 %)");
    expect(norm(pts[1].text)).toBe('Reste à vivre : 5,7 % du revenu (seuil 10 %)');
    expect(norm(pts[2].text)).toBe('COFIDIS utilisé à 62 % du plafond (seuil 60 %)');
  });

  it('aucun point quand tout est vert', () => {
    expect(attentionPoints(diag({}))).toEqual([]);
  });
});
