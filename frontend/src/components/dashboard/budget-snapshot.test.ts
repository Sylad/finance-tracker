import { describe, expect, it } from 'vitest';
import type { TransactionCategory } from '@/types/api';
import { buildItems } from './budget-snapshot';

const tx = (category: TransactionCategory, amount: number) => ({ category, amount });

describe('buildItems (budget snapshot)', () => {
  it('returns an empty list when the budget is empty', () => {
    expect(buildItems({}, [tx('food', -10)])).toEqual([]);
  });

  it('skips entries with zero / nullish / non-positive limits', () => {
    const out = buildItems(
      { food: 200, transport: 0, housing: undefined },
      [tx('food', -10)],
    );
    expect(out.map((i) => i.category)).toEqual(['food']);
  });

  it('sums absolute values of debits only (ignores credits)', () => {
    const out = buildItems(
      { food: 200 },
      [
        tx('food', -50),
        tx('food', -25),
        tx('food', 30),   // credit refund — must be ignored
        tx('transport', -100), // unrelated category
      ],
    );
    expect(out).toHaveLength(1);
    expect(out[0].spent).toBe(75);
    expect(out[0].limit).toBe(200);
    expect(out[0].pct).toBe(38);   // round(75/200*100)
    expect(out[0].over).toBe(false);
  });

  it('flags `over` when spent strictly exceeds the limit', () => {
    const out = buildItems({ food: 100 }, [tx('food', -150)]);
    expect(out[0].over).toBe(true);
    expect(out[0].pct).toBe(150);
  });

  it('orders items by descending percentage', () => {
    const out = buildItems(
      { food: 100, transport: 100, housing: 1000 },
      [
        tx('food', -90),       // 90 %
        tx('transport', -10),  // 10 %
        tx('housing', -500),   // 50 %
      ],
    );
    expect(out.map((i) => i.category)).toEqual(['food', 'housing', 'transport']);
  });

  it('uses the canonical FR label when known, falls back to the raw category id otherwise', () => {
    const out = buildItems(
      { food: 100, /* unknown but typed-cast key on purpose: */ ['mystery' as TransactionCategory]: 50 },
      [],
    );
    const food = out.find((i) => i.category === 'food');
    const mystery = out.find((i) => i.category === 'mystery');
    expect(food?.label).toBe('Alimentation');
    // Unknown category id flows through as-is
    expect(mystery?.label).toBe('mystery');
  });
});
