import { readFileSync } from 'fs';
import { join } from 'path';

// L15 : l'arrondi au centime a une source unique (common/money.ts).
describe('round2 — source unique', () => {
  const files = [
    'modules/credit-detection/detection-validator.service.ts',
    'modules/expenses/expenses.service.ts',
  ];
  it.each(files)('%s ne redéfinit pas l\'arrondi', (f) => {
    const src = readFileSync(join(__dirname, '..', f), 'utf8');
    expect(src).not.toMatch(/static round2\(/);
    expect(src).not.toMatch(/const round = \(n: number\)/);
  });
});
