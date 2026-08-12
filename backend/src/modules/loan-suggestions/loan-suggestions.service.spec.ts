import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LoanSuggestionsService } from './loan-suggestions.service';
import { LoansService } from '../loans/loans.service';
import { StorageService } from '../storage/storage.service';
import { EventBusService } from '../events/event-bus.service';
import { RequestDataDirService } from '../demo/request-data-dir.service';

describe('LoanSuggestionsService', () => {
  let svc: LoanSuggestionsService;
  let loansSvc: LoansService;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-sugg-'));
    const mod = await Test.createTestingModule({
      providers: [
        LoanSuggestionsService,
        LoansService,
        {
          provide: RequestDataDirService,
          useValue: {
            getDataDir: () => tmpDir,
            isDemoMode: () => false,
            runWith: (_ctx: any, fn: any) => fn(),
          },
        },
        { provide: EventBusService, useValue: { emit: jest.fn() } },
        {
          provide: StorageService,
          useValue: { getAllStatements: jest.fn(async () => []) },
        },
      ],
    }).compile();
    svc = mod.get(LoanSuggestionsService);
    loansSvc = mod.get(LoansService);
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('upserts a new pending suggestion', async () => {
    await svc.upsertMany('2026-03', [
      {
        label: 'PRELEVT CETELEM',
        monthlyAmount: 320,
        occurrencesSeen: 5,
        firstSeenDate: '2025-11-15',
        suggestedType: 'loan',
        matchPattern: 'PRELEVT.*CETELEM',
      },
    ]);
    const all = await svc.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe('pending');
    expect(all[0].occurrencesSeen).toBe(5);
  });

  it('deduplicates by matchPattern (incrementing occurrencesSeen)', async () => {
    const incoming = {
      label: 'PRELEVT CETELEM',
      monthlyAmount: 320,
      occurrencesSeen: 5,
      firstSeenDate: '2025-11-15',
      suggestedType: 'loan' as const,
      matchPattern: 'PRELEVT.*CETELEM',
    };
    await svc.upsertMany('2026-03', [incoming]);
    await svc.upsertMany('2026-04', [
      { ...incoming, occurrencesSeen: 6, firstSeenDate: '2026-04-01' },
    ]);
    const all = await svc.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].occurrencesSeen).toBe(6);
    expect(all[0].lastSeenDate).toBe('2026-04-01');
  });

  it('does not resurrect rejected suggestions', async () => {
    const incoming = {
      label: 'X',
      monthlyAmount: 10,
      occurrencesSeen: 3,
      firstSeenDate: '2025-11-01',
      suggestedType: 'loan' as const,
      matchPattern: 'X',
    };
    await svc.upsertMany('2026-03', [incoming]);
    const [s] = await svc.getAll();
    await svc.reject(s.id);
    await svc.upsertMany('2026-04', [incoming]);
    const all = await svc.getAll();
    expect(all.find((x) => x.id === s.id)?.status).toBe('rejected');
  });

  it('accept marks resolvedAt and stores acceptedAsLoanId', async () => {
    await svc.upsertMany('2026-03', [
      {
        label: 'Y',
        monthlyAmount: 50,
        occurrencesSeen: 4,
        firstSeenDate: '2025-11-01',
        suggestedType: 'loan',
        matchPattern: 'Y',
      },
    ]);
    const [s] = await svc.getAll();
    const updated = await svc.accept(s.id, { loanId: 'loan-123' });
    expect(updated.status).toBe('accepted');
    expect(updated.acceptedAsLoanId).toBe('loan-123');
    expect(updated.resolvedAt).toBeDefined();
  });

  it('accept routes a subscription suggestion to acceptedAsSubscriptionId', async () => {
    await svc.upsertMany('2026-03', [
      {
        label: 'NETFLIX',
        monthlyAmount: 17.99,
        occurrencesSeen: 4,
        firstSeenDate: '2025-11-01',
        suggestedType: 'subscription',
        matchPattern: 'NETFLIX',
      },
    ]);
    const [s] = await svc.getAll();
    const updated = await svc.accept(s.id, { subscriptionId: 'sub-456' });
    expect(updated.status).toBe('accepted');
    expect(updated.acceptedAsSubscriptionId).toBe('sub-456');
    expect(updated.acceptedAsLoanId).toBeUndefined();
  });

  it('resetAllToPending : reset toutes les suggestions snoozed/rejected/accepted à pending', async () => {
    await svc.upsertMany('2026-03', [
      {
        label: 'A',
        monthlyAmount: 10,
        occurrencesSeen: 5,
        firstSeenDate: '2025-11-01',
        suggestedType: 'loan',
        matchPattern: 'A',
      },
      {
        label: 'B',
        monthlyAmount: 20,
        occurrencesSeen: 5,
        firstSeenDate: '2025-11-01',
        suggestedType: 'loan',
        matchPattern: 'B',
      },
      {
        label: 'C',
        monthlyAmount: 30,
        occurrencesSeen: 5,
        firstSeenDate: '2025-11-01',
        suggestedType: 'loan',
        matchPattern: 'C',
      },
    ]);
    const all = await svc.getAll();
    await svc.reject(all[0].id);
    await svc.snooze(all[1].id);
    await svc.accept(all[2].id, { loanId: 'loan-X' });

    const result = await svc.resetAllToPending();
    expect(result.resetCount).toBe(3);
    const after = await svc.getAll();
    expect(after.every((s) => s.status === 'pending')).toBe(true);
    expect(after.every((s) => s.acceptedAsLoanId === undefined)).toBe(true);
    expect(after.every((s) => s.resolvedAt === undefined)).toBe(true);
  });

  it('round-trip installment/source : persistés à la création, conservés au dédup', async () => {
    const incoming = {
      label: '4× klarni · zoland',
      monthlyAmount: 44.98,
      occurrencesSeen: 3,
      firstSeenDate: '2026-01-10',
      suggestedType: 'loan' as const,
      matchPattern: 'klarni',
      creditor: 'klarni',
      installment: {
        count: 4,
        merchant: 'zoland',
        occurrenceTxIds: ['a', 'b', 'c'],
        amounts: [44.98, 44.5, 45.1],
        dates: ['2026-01-10', '2026-02-08', '2026-03-07'],
      },
      source: 'llm_detection' as const,
    };

    await svc.upsertMany('2026-03', [incoming]);
    const [created] = await svc.getPending();
    expect(created.installment).toEqual(incoming.installment);
    expect(created.source).toBe('llm_detection');

    // second upsertMany identique (dédup par creditor) : pas de doublon, champs conservés
    await svc.upsertMany('2026-03', [incoming]);
    const pending = await svc.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].installment).toEqual(incoming.installment);
    expect(pending[0].source).toBe('llm_detection');
  });

  it("dédup installment : même creditor, 3 sous-séries à montants distincts -> 3 suggestions conservées (pas d'écrasement)", async () => {
    // Round 2 fix : un même cluster creditor|merchant peut porter plusieurs
    // plans N× (DetectionValidatorService.splitByAmount). Chaque sous-série
    // appelle upsertMany séparément avec le même creditor mais un
    // monthlyAmount différent — la dédup par creditor seul écrasait les 2
    // premières. Doit désormais garder 3 entrées distinctes.
    const planA = {
      label: '3× klarni · zoland (42€)',
      monthlyAmount: 42,
      occurrencesSeen: 2,
      firstSeenDate: '2026-01-05',
      suggestedType: 'loan' as const,
      matchPattern: 'klarni',
      creditor: 'klarni',
      installment: {
        count: 3,
        merchant: 'zoland',
        occurrenceTxIds: ['a1', 'a2'],
        amounts: [41.99, 42.0],
        dates: ['2026-01-05', '2026-02-04'],
      },
      source: 'llm_detection' as const,
    };
    const planB = {
      ...planA,
      label: '3× klarni · zoland (44.98€)',
      monthlyAmount: 44.98,
      occurrenceTxIds: undefined,
      installment: {
        count: 3,
        merchant: 'zoland',
        occurrenceTxIds: ['b1', 'b2'],
        amounts: [44.98, 44.98],
        dates: ['2026-01-15', '2026-02-14'],
      },
    };
    const planC = {
      ...planA,
      label: '3× klarni · zoland (51.97€)',
      monthlyAmount: 51.97,
      installment: {
        count: 3,
        merchant: 'zoland',
        occurrenceTxIds: ['c1', 'c2'],
        amounts: [51.97, 51.98],
        dates: ['2026-01-25', '2026-02-24'],
      },
    };

    await svc.upsertMany('2026-02', [planA]);
    await svc.upsertMany('2026-02', [planB]);
    await svc.upsertMany('2026-02', [planC]);

    const pending = await svc.getPending();
    expect(pending).toHaveLength(3);
    expect(pending.map((p) => p.label).sort()).toEqual(
      [planA.label, planB.label, planC.label].sort(),
    );

    // Re-scan identique (même creditor + mêmes montants) -> toujours 3, pas 6
    await svc.upsertMany('2026-03', [planA]);
    await svc.upsertMany('2026-03', [planB]);
    await svc.upsertMany('2026-03', [planC]);
    const afterRescan = await svc.getPending();
    expect(afterRescan).toHaveLength(3);
  });

  it("dédup : incoming sans installment ne détruit pas un installment déjà présent sur l'existante", async () => {
    const withInstallment = {
      label: '4× klarni · zoland',
      monthlyAmount: 44.98,
      occurrencesSeen: 3,
      firstSeenDate: '2026-01-10',
      suggestedType: 'loan' as const,
      matchPattern: 'klarni',
      creditor: 'klarni',
      installment: {
        count: 4,
        merchant: 'zoland',
        occurrenceTxIds: ['a', 'b', 'c'],
        amounts: [44.98, 44.5, 45.1],
        dates: ['2026-01-10', '2026-02-08', '2026-03-07'],
      },
      source: 'llm_detection' as const,
    };
    await svc.upsertMany('2026-03', [withInstallment]);

    const { installment, ...rest } = withInstallment;
    void installment;
    const withoutInstallment = {
      ...rest,
      occurrencesSeen: 4,
      firstSeenDate: '2026-04-07',
    };
    await svc.upsertMany('2026-04', [withoutInstallment]);

    const [s] = await svc.getPending();
    expect(s.occurrencesSeen).toBe(4);
    expect(s.installment).toEqual(withInstallment.installment);
  });

  it('round-trip evidence : persisté à la création, conservé au dédup, non clobbé par un incoming sans evidence', async () => {
    const withEvidence = {
      label: '4× klarni · zoland',
      monthlyAmount: 44.98,
      occurrencesSeen: 3,
      firstSeenDate: '2026-01-10',
      suggestedType: 'loan' as const,
      matchPattern: 'klarni',
      creditor: 'klarni',
      evidence: {
        occurrences: [
          {
            date: '2026-01-10',
            amount: 44.98,
            description: 'Achat CB Klarni*Zoland 4X 1/3',
          },
          {
            date: '2026-02-08',
            amount: 44.5,
            description: 'Klarni*Zoland 4X 2/3',
          },
          {
            date: '2026-03-07',
            amount: 45.1,
            description: 'Klarni*Zoland 4X 3/3',
          },
        ],
        rationale: 'Trois débits quasi identiques',
        lastSeenDate: '2026-03-07',
      },
    };

    await svc.upsertMany('2026-03', [withEvidence]);
    const [created] = await svc.getPending();
    expect(created.evidence).toEqual(withEvidence.evidence);

    // dédup identique (même creditor) -> conservé
    await svc.upsertMany('2026-03', [withEvidence]);
    const pending = await svc.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].evidence).toEqual(withEvidence.evidence);

    // incoming sans evidence ne détruit pas l'evidence déjà présente
    const { evidence, ...rest } = withEvidence;
    void evidence;
    await svc.upsertMany('2026-04', [
      { ...rest, occurrencesSeen: 4, firstSeenDate: '2026-04-07' },
    ]);
    const [s] = await svc.getPending();
    expect(s.occurrencesSeen).toBe(4);
    expect(s.evidence).toEqual(withEvidence.evidence);
  });

  it('deleteAll : purge totale', async () => {
    await svc.upsertMany('2026-03', [
      {
        label: 'A',
        monthlyAmount: 10,
        occurrencesSeen: 5,
        firstSeenDate: '2025-11-01',
        suggestedType: 'loan',
        matchPattern: 'A',
      },
      {
        label: 'B',
        monthlyAmount: 20,
        occurrencesSeen: 5,
        firstSeenDate: '2025-11-01',
        suggestedType: 'loan',
        matchPattern: 'B',
      },
    ]);
    const result = await svc.deleteAll();
    expect(result.deletedCount).toBe(2);
    expect(await svc.getAll()).toHaveLength(0);
  });

  describe('acceptInstallment', () => {
    // Horloge figée à 2026-08-12 — les fixtures ci-dessous (dates, projection
    // du schedule, isActive attendu) sont calculées relativement à cette
    // date fixe, pas à la date système réelle du run (sinon le test casse
    // dès que la vraie horloge dépasse la fenêtre observée/projetée).
    // On ne fake QUE Date (doNotFake = tout le reste) pour ne pas geler les
    // I/O async (fs, Test.createTestingModule().compile()) utilisés par le
    // spec.
    beforeEach(() => {
      jest.useFakeTimers({
        doNotFake: [
          'hrtime',
          'nextTick',
          'performance',
          'queueMicrotask',
          'requestAnimationFrame',
          'cancelAnimationFrame',
          'requestIdleCallback',
          'cancelIdleCallback',
          'setImmediate',
          'clearImmediate',
          'setInterval',
          'clearInterval',
          'setTimeout',
          'clearTimeout',
        ],
      });
      jest.setSystemTime(new Date('2026-08-12T00:00:00Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    // 3 occurrences observées + 1 projetée qui tombe APRÈS le "aujourd'hui"
    // figé ci-dessus, pour représenter une série pas encore terminée
    // (isActive attendu = true). Cf test (d) ci-dessous pour le cas série
    // terminée.
    const installmentIncoming = {
      label: '4× klarni · zoland',
      monthlyAmount: 44.98,
      occurrencesSeen: 3,
      firstSeenDate: '2026-06-14',
      suggestedType: 'loan' as const,
      matchPattern: 'klarni',
      creditor: 'klarni',
      installment: {
        count: 4,
        merchant: 'zoland',
        occurrenceTxIds: ['a', 'b', 'c'],
        amounts: [44.98, 44.5, 45.1],
        dates: ['2026-06-14', '2026-07-13', '2026-08-10'],
      },
      source: 'llm_detection' as const,
    };

    it('(a) crée un loan kind=installment avec 4 lignes (3 observées + 1 projetée) et marque la suggestion accepted', async () => {
      await svc.upsertMany('2026-03', [installmentIncoming]);
      const [s] = await svc.getPending();

      const updated = await svc.acceptInstallment(s.id);

      expect(updated.status).toBe('accepted');
      expect(updated.acceptedAsLoanId).toBeDefined();

      const loans = await loansSvc.getAll();
      expect(loans).toHaveLength(1);
      const loan = loans[0];
      expect(loan.id).toBe(updated.acceptedAsLoanId);
      expect(loan.kind).toBe('installment');
      expect(loan.type).toBe('classic');
      expect(loan.category).toBe('consumer');
      expect(loan.creditor).toBe('klarni');
      expect(loan.installmentMerchant).toBe('zoland');
      expect(loan.matchPattern).toBe('klarni');

      const schedule = loan.installmentSchedule!;
      expect(schedule).toHaveLength(4);
      expect(schedule[0]).toMatchObject({
        dueDate: '2026-06-14',
        amount: 44.98,
        paid: true,
      });
      expect(schedule[1]).toMatchObject({
        dueDate: '2026-07-13',
        amount: 44.5,
        paid: true,
      });
      expect(schedule[2]).toMatchObject({
        dueDate: '2026-08-10',
        amount: 45.1,
        paid: true,
      });
      // 4e ligne projetée : pas médian (29j, 28j) → 29j après 2026-08-10, montant médian 44.98
      expect(schedule[3]).toMatchObject({
        dueDate: '2026-09-08',
        amount: 44.98,
        paid: false,
      });

      // (finding 1) occurrencesDetected seedées depuis dates/amounts/occurrenceTxIds —
      // amount négatif (débit), transactionId reporté, source bank_statement.
      expect(loan.occurrencesDetected).toHaveLength(3);
      const byDate = Object.fromEntries(
        loan.occurrencesDetected.map((o) => [o.date, o]),
      );
      expect(byDate['2026-06-14']).toMatchObject({
        amount: -44.98,
        transactionId: 'a',
        source: 'bank_statement',
      });
      expect(byDate['2026-07-13']).toMatchObject({
        amount: -44.5,
        transactionId: 'b',
        source: 'bank_statement',
      });
      expect(byDate['2026-08-10']).toMatchObject({
        amount: -45.1,
        transactionId: 'c',
        source: 'bank_statement',
      });

      // (fix round 2, finding 1) paidOccurrenceId doit être le vrai id
      // (uuid) de la LoanOccurrence dont le transactionId correspond — pas
      // le statementId synthétique. On retrouve chaque occurrence par
      // transactionId plutôt que par position.
      const byTxId = new Map(
        loan.occurrencesDetected
          .filter((o) => o.transactionId)
          .map((o) => [o.transactionId as string, o]),
      );
      expect(schedule[0].paidOccurrenceId).toBe(byTxId.get('a')?.id);
      expect(schedule[1].paidOccurrenceId).toBe(byTxId.get('b')?.id);
      expect(schedule[2].paidOccurrenceId).toBe(byTxId.get('c')?.id);
      // Un vrai uuid, pas '2026-06' (l'ancien statementId synthétique)
      expect(schedule[0].paidOccurrenceId).not.toBe('2026-06');
      expect(schedule[3].paidOccurrenceId).toBeUndefined();

      // Série pas encore terminée (échéance projetée dans le futur) → actif
      expect(loan.isActive).toBe(true);
    });

    it('(c) count null (installmentCount LLM normalisé à null par le validateur, round 8) -> échéancier = observées uniquement, pas de projection', async () => {
      // Round 8 fix 3 : verrouille le comportement quand le validateur a
      // ramené un installmentCount non fiable à null (cf
      // DetectionValidatorService.normalizeInstallmentCount) — même
      // trajectoire que le comportement historique de convertToInstallment
      // (count inconnu -> buildInstallmentSchedule ne projette rien).
      await svc.upsertMany('2026-03', [
        {
          label: '3× klarni · zoland',
          monthlyAmount: 44.98,
          occurrencesSeen: 3,
          firstSeenDate: '2026-06-14',
          suggestedType: 'loan' as const,
          matchPattern: 'klarni',
          creditor: 'klarni',
          installment: {
            count: null,
            merchant: 'zoland',
            occurrenceTxIds: ['a', 'b', 'c'],
            amounts: [44.98, 44.5, 45.1],
            dates: ['2026-06-14', '2026-07-13', '2026-08-10'],
          },
          source: 'llm_detection' as const,
        },
      ]);
      const [s] = await svc.getPending();

      await svc.acceptInstallment(s.id);

      const [loan] = await loansSvc.getAll();
      expect(loan.installmentSchedule).toHaveLength(3); // count null -> aucune projection
      expect(loan.installmentSchedule!.every((l) => l.paid)).toBe(true);
      expect(loan.isActive).toBe(false); // toutes les échéances observées sont passées
    });

    it('(d) série terminée (count = occurrences observées, toutes échéances passées) → loan créé inactif', async () => {
      await svc.upsertMany('2026-03', [
        {
          label: '3× cofidis · amazon',
          monthlyAmount: 65.81,
          occurrencesSeen: 3,
          firstSeenDate: '2025-01-10',
          suggestedType: 'loan' as const,
          matchPattern: 'cofidis',
          creditor: 'cofidis',
          installment: {
            count: 3,
            merchant: 'amazon',
            occurrenceTxIds: ['x', 'y', 'z'],
            amounts: [65.81, 65.81, 65.81],
            dates: ['2025-01-10', '2025-02-10', '2025-03-10'],
          },
          source: 'llm_detection' as const,
        },
      ]);
      const [s] = await svc.getPending();

      await svc.acceptInstallment(s.id);

      const [loan] = await loansSvc.getAll();
      expect(loan.installmentSchedule).toHaveLength(3); // count = observées → aucune projection
      expect(loan.isActive).toBe(false);
      expect(loan.endDate).toBe('2025-03-10');
    });

    it('(b) suggestion sans installment → BadRequestException', async () => {
      await svc.upsertMany('2026-03', [
        {
          label: 'PRELEVT CETELEM',
          monthlyAmount: 320,
          occurrencesSeen: 5,
          firstSeenDate: '2025-11-15',
          suggestedType: 'loan',
          matchPattern: 'PRELEVT.*CETELEM',
        },
      ]);
      const [s] = await svc.getPending();
      await expect(svc.acceptInstallment(s.id)).rejects.toThrow(/installment/);

      // Aucun loan créé
      expect(await loansSvc.getAll()).toHaveLength(0);
    });

    it('(c) suggestion déjà accepted → BadRequestException, pas de second loan créé', async () => {
      await svc.upsertMany('2026-03', [installmentIncoming]);
      const [s] = await svc.getPending();
      await svc.acceptInstallment(s.id);

      await expect(svc.acceptInstallment(s.id)).rejects.toThrow();
      expect(await loansSvc.getAll()).toHaveLength(1);
    });
  });
});
