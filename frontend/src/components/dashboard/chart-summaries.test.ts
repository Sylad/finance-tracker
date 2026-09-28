import { describe, expect, it } from 'vitest';
import { summarizeTrend, summarizeInOut } from './chart-summaries';

const norm = (s: string) => s.replace(/[  ]/g, ' ');

describe('résumés textuels des graphiques (L21/t3)', () => {
  it('résume une série de score : période, départ, arrivée, extrêmes', () => {
    const out = summarizeTrend('Score de santé', [
      { label: 'Oct 25', value: 72 },
      { label: 'Nov 25', value: 66 },
      { label: 'Mar 26', value: 75 },
    ]);
    expect(out).toBe('Score de santé sur 3 mois : de 72 (Oct 25) à 75 (Mar 26), minimum 66 (Nov 25), maximum 75 (Mar 26).');
  });

  it('formate les valeurs avec le formateur fourni', () => {
    const out = norm(summarizeTrend('Solde', [
      { label: 'Oct 25', value: 1520 },
      { label: 'Nov 25', value: 1138.2 },
    ], (v) => `${Math.round(v)} €`));
    expect(out).toBe('Solde sur 2 mois : de 1520 € (Oct 25) à 1138 € (Nov 25), minimum 1138 € (Nov 25), maximum 1520 € (Oct 25).');
  });

  it('série vide ou d’un seul point : phrase explicite', () => {
    expect(summarizeTrend('Solde', [])).toBe('Solde : pas encore de données.');
    expect(summarizeTrend('Solde', [{ label: 'Mar 26', value: 3 }])).toBe('Solde : 3 (Mar 26).');
  });

  it('résume entrées et sorties, et compte les mois déficitaires', () => {
    const out = norm(summarizeInOut([
      { label: 'Oct 25', credits: 2800, debits: 2800.89 },
      { label: 'Nov 25', credits: 2800, debits: 3110.9 },
      { label: 'Déc 25', credits: 2950, debits: 2754.9 },
    ]));
    expect(out).toBe(
      'Entrées et sorties sur 3 mois. Entrées : 8 550,00 € au total. Sorties : 8 666,69 € au total. '
      + '2 mois où les sorties dépassent les entrées, le plus marqué : Nov 25 (-310,90 €).',
    );
  });

  it('aucun mois déficitaire', () => {
    const out = norm(summarizeInOut([{ label: 'Oct 25', credits: 3000, debits: 2000 }]));
    expect(out).toBe('Entrées et sorties sur 1 mois. Entrées : 3 000,00 € au total. Sorties : 2 000,00 € au total. Aucun mois où les sorties dépassent les entrées.');
  });
});
