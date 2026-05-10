import { CreditStatementOutputSchema } from './credit-statement.schemas';

describe('CreditStatementOutputSchema', () => {
  const validClassic = {
    creditor: 'COFIDIS',
    creditType: 'classic' as const,
    currentBalance: 4521.32,
    monthlyPayment: 89.5,
    endDate: '2028-06-15',
    taeg: 4.85,
    statementDate: '2026-04-30',
    accountNumber: '51215116521100',
  };

  const validRevolving = {
    creditor: 'CARREFOUR BANQUE',
    creditType: 'revolving' as const,
    currentBalance: 1234.56,
    maxAmount: 3000,
    monthlyPayment: 75,
    endDate: null,
    taeg: 19.84,
    statementDate: '2026-04-30',
    accountNumber: null,
  };

  it('accepts a minimal valid classic payload', () => {
    expect(() => CreditStatementOutputSchema.parse(validClassic)).not.toThrow();
  });

  it('accepts a minimal valid revolving payload', () => {
    expect(() => CreditStatementOutputSchema.parse(validRevolving)).not.toThrow();
  });

  it('accepts revolving without endDate / taeg / accountNumber', () => {
    const stripped = {
      creditor: 'COFIDIS',
      creditType: 'revolving' as const,
      currentBalance: 500,
      maxAmount: 1500,
      monthlyPayment: 60,
      statementDate: '2026-04-30',
    };
    expect(() => CreditStatementOutputSchema.parse(stripped)).not.toThrow();
  });

  it('rejects revolving without maxAmount (business rule)', () => {
    const noMax = { ...validRevolving } as Record<string, unknown>;
    delete noMax.maxAmount;
    expect(() => CreditStatementOutputSchema.parse(noMax)).toThrow();
  });

  it('rejects revolving with maxAmount = 0', () => {
    expect(() =>
      CreditStatementOutputSchema.parse({ ...validRevolving, maxAmount: 0 }),
    ).toThrow();
  });

  it('rejects bad creditType enum', () => {
    expect(() =>
      CreditStatementOutputSchema.parse({ ...validClassic, creditType: 'mortgage' }),
    ).toThrow();
  });

  it('rejects missing required field (currentBalance)', () => {
    const { currentBalance: _omit, ...incomplete } = validClassic;
    expect(() => CreditStatementOutputSchema.parse(incomplete)).toThrow();
  });

  it('rejects missing required field (statementDate)', () => {
    const { statementDate: _omit, ...incomplete } = validClassic;
    expect(() => CreditStatementOutputSchema.parse(incomplete)).toThrow();
  });

  it('accepts endDate as null or omitted (optional)', () => {
    const r1 = CreditStatementOutputSchema.parse({ ...validClassic, endDate: null });
    expect(r1.endDate).toBeNull();
    const without = { ...validClassic } as Record<string, unknown>;
    delete without.endDate;
    expect(() => CreditStatementOutputSchema.parse(without)).not.toThrow();
  });

  it('accepts taeg as null or omitted', () => {
    const r = CreditStatementOutputSchema.parse({ ...validClassic, taeg: null });
    expect(r.taeg).toBeNull();
  });

  it('coerces numeric strings (Claude renvoie parfois "1234" au lieu de 1234)', () => {
    // Pattern observé sur les contrats Cofidis 4XCB : Claude met maxAmount
    // en string. Le schema doit coercer pour ne pas faire échouer l'import.
    const r = CreditStatementOutputSchema.parse({
      ...validClassic,
      currentBalance: '4521.50' as any,
      maxAmount: '1000' as any,
    });
    expect(r.currentBalance).toBe(4521.5);
    expect(r.maxAmount).toBe(1000);
  });

  it('rejects truly non-numeric currentBalance (pas une string numérique)', () => {
    expect(() =>
      CreditStatementOutputSchema.parse({ ...validClassic, currentBalance: 'not-a-number' as any }),
    ).toThrow();
  });
});
