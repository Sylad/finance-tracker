import { PAY_IN_N_PATTERN } from './loans-patterns';

describe('PAY_IN_N_PATTERN', () => {
  it.each(['COFIDIS 4XCB', 'PRLV FLOA 3XCB 1/3', 'ZOLAND 4X', 'PAIEMENT EN 3 FOIS'])(
    'reconnaît %s',
    (label) => expect(PAY_IN_N_PATTERN.test(label)).toBe(true),
  );

  it('ne reconnaît pas un libellé sans fractionné', () => {
    expect(PAY_IN_N_PATTERN.test('PRLV COFIDIS 0042')).toBe(false);
  });
});
