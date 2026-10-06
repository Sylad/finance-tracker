import { ConflictException } from '@nestjs/common';
import { CreditDetectionController } from './credit-detection.controller';
import { CreditDetectionService } from './credit-detection.service';

describe('CreditDetectionController', () => {
  it('POST /scan répond 409 quand un scan est déjà en cours (L4)', async () => {
    const svc = {
      scanAll: jest.fn().mockResolvedValue({
        clustersAnalyzed: 0,
        suggestionsCreated: 0,
        errors: [],
        skipped: true,
      }),
    };
    const ctrl = new CreditDetectionController(
      svc as unknown as CreditDetectionService,
    );
    await expect(ctrl.scan()).rejects.toThrow(ConflictException);
  });

  it('POST /scan renvoie le résultat tel quel quand le scan a tourné', async () => {
    const result = { clustersAnalyzed: 2, suggestionsCreated: 1, errors: [] };
    const svc = { scanAll: jest.fn().mockResolvedValue(result) };
    const ctrl = new CreditDetectionController(
      svc as unknown as CreditDetectionService,
    );
    await expect(ctrl.scan()).resolves.toEqual(result);
  });
});
