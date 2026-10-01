import { describe, expect, it } from 'vitest';
import { ageLabel, formatDay, groupPlan, newsSlugByLot, progress, summary, type PlanLot } from './plan';

const today = new Date('2026-10-01T10:00:00');

const lots: PlanLot[] = [
  { id: 'L1', title: 'Livré il y a longtemps', status: 'done', started: '2026-08-01', finished: '2026-08-15' },
  { id: 'L2', title: 'Livré hier', status: 'done', started: '2026-09-29', finished: '2026-09-30' },
  { id: 'L3', title: 'Prévu A', status: 'todo' },
  { id: 'L4', title: 'En cours', status: 'doing', started: '2026-10-01', tasks: [
    { title: 'a', status: 'done' }, { title: 'b', status: 'todo' }, { title: 'c', status: 'doing' },
  ] },
  { id: 'L5', title: 'Livré il y a 30 jours', status: 'done', finished: '2026-09-01' },
  { id: 'L6', title: 'Prévu B', status: 'todo' },
  { id: 'L7', title: 'Livré il y a 31 jours', status: 'done', finished: '2026-08-31' },
  { id: 'L8', title: 'Livré sans date', status: 'done' },
  { id: 'L9', title: 'Livré le 28', status: 'done', finished: '2026-09-28' },
];

describe('groupPlan', () => {
  const g = groupPlan(lots, today);

  it('en cours et prévus dans l’ordre du plan', () => {
    expect(g.doing.map((l) => l.id)).toEqual(['L4']);
    expect(g.todo.map((l) => l.id)).toEqual(['L3', 'L6']);
  });

  it('livrés des 30 derniers jours, le plus récent en premier', () => {
    expect(g.done.map((l) => l.id)).toEqual(['L2', 'L9', 'L5']);
    expect(g.olderDone).toBe(3);
  });
});

describe('progress', () => {
  it('compte les sous-tâches terminées', () => {
    expect(progress(lots[3])).toEqual({ done: 1, total: 3 });
  });
  it('null sans sous-tâche', () => {
    expect(progress(lots[2])).toBeNull();
    expect(progress({ ...lots[2], tasks: [] })).toBeNull();
  });
});

describe('dates en français', () => {
  it('formate un jour', () => {
    expect(formatDay('2026-09-28')).toBe('28 septembre 2026');
  });
  it('donne un âge lisible', () => {
    expect(ageLabel('2026-10-01', today)).toBe("aujourd'hui");
    expect(ageLabel('2026-09-30', today)).toBe('hier');
    expect(ageLabel('2026-09-28', today)).toBe('il y a 3 jours');
  });
});

describe('summary', () => {
  it('résume « en ce moment » en accordant les pluriels', () => {
    expect(summary(groupPlan(lots, today))).toBe('1 lot en cours, 2 prévus, 3 livrés ces 30 derniers jours.');
    expect(summary({ doing: [], todo: [lots[2]], done: [lots[1]], olderDone: 0 })).toBe(
      'Rien en cours, 1 prévu, 1 livré ces 30 derniers jours.',
    );
  });
});

describe('newsSlugByLot', () => {
  it('associe chaque lot à sa dernière entrée Nouveautés', () => {
    const m = newsSlugByLot([
      { slug: 'b-recent', lots: ['L2'] },
      { slug: 'a-ancien', lots: ['L2', 'L9'] },
    ]);
    expect(m.get('L2')).toBe('b-recent');
    expect(m.get('L9')).toBe('a-ancien');
    expect(m.get('L4')).toBeUndefined();
  });
});
