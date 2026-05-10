import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LoansService } from './loans.service';
import { EventBusService } from '../events/event-bus.service';
import { RequestDataDirService } from '../demo/request-data-dir.service';

describe('LoansService', () => {
  let svc: LoansService;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-loans-'));
    const mod = await Test.createTestingModule({
      providers: [
        LoansService,
        { provide: RequestDataDirService, useValue: { getDataDir: () => tmpDir, isDemoMode: () => false, runWith: (_ctx: any, fn: any) => fn() } },
        { provide: EventBusService, useValue: { emit: jest.fn() } },
      ],
    }).compile();
    svc = mod.get(LoansService);
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('starts empty', async () => {
    expect(await svc.getAll()).toEqual([]);
  });

  it('creates a classic loan', async () => {
    const loan = await svc.create({
      name: 'Crédit auto',
      type: 'classic',
      category: 'auto',
      monthlyPayment: 240,
      matchPattern: 'PRELEVT.*BANQUE',
      isActive: true,
      startDate: '2025-01-01',
      endDate: '2028-01-01',
    });
    expect(loan.id).toBeDefined();
    expect(loan.type).toBe('classic');
    expect(loan.occurrencesDetected).toEqual([]);
  });

  it('creates a revolving loan', async () => {
    const loan = await svc.create({
      name: 'Carte magasin',
      type: 'revolving',
      category: 'consumer',
      monthlyPayment: 80,
      matchPattern: 'COFIDIS',
      isActive: true,
      maxAmount: 3000,
      usedAmount: 1200,
    });
    expect(loan.maxAmount).toBe(3000);
    expect(loan.usedAmount).toBe(1200);
  });

  it('addOccurrence is idempotent on (statementId, transactionId)', async () => {
    const loan = await svc.create({
      name: 'Test',
      type: 'classic',
      category: 'consumer',
      monthlyPayment: 100,
      matchPattern: 'TEST',
      isActive: true,
    });
    await svc.addOccurrence(loan.id, { statementId: '2026-03', date: '2026-03-15', amount: -100, transactionId: 'tx-1' });
    await svc.addOccurrence(loan.id, { statementId: '2026-03', date: '2026-03-15', amount: -100, transactionId: 'tx-1' });
    const reloaded = await svc.getOne(loan.id);
    expect(reloaded.occurrencesDetected).toHaveLength(1);
  });

  it('addOccurrence on revolving decrements usedAmount', async () => {
    const loan = await svc.create({
      name: 'Carte',
      type: 'revolving',
      category: 'consumer',
      monthlyPayment: 80,
      matchPattern: 'C',
      isActive: true,
      maxAmount: 3000,
      usedAmount: 1200,
    });
    await svc.addOccurrence(loan.id, { statementId: '2026-03', date: '2026-03-15', amount: -80, transactionId: 'tx-1' });
    const reloaded = await svc.getOne(loan.id);
    expect(reloaded.usedAmount).toBe(1120);
  });

  it('resetRevolving updates usedAmount and lastManualResetAt', async () => {
    const loan = await svc.create({
      name: 'Carte',
      type: 'revolving',
      category: 'consumer',
      monthlyPayment: 80,
      matchPattern: 'C',
      isActive: true,
      maxAmount: 3000,
      usedAmount: 1200,
    });
    const updated = await svc.resetRevolving(loan.id, 800);
    expect(updated.usedAmount).toBe(800);
    expect(updated.lastManualResetAt).toBeDefined();
  });

  describe('findByIdentifiers (matcher avec RUM fallback)', () => {
    it('matches by contractRef when accountNumber provided', async () => {
      const loan = await svc.create({
        name: 'Cofidis',
        type: 'revolving',
        category: 'consumer',
        monthlyPayment: 80,
        matchPattern: 'COFIDIS',
        isActive: true,
        creditor: 'COFIDIS',
        contractRef: '51215116521100',
        maxAmount: 3000,
        usedAmount: 0,
      });
      const found = await svc.findByIdentifiers({ accountNumber: '51215116521100' });
      expect(found?.id).toBe(loan.id);
    });

    it('matches by contractRef with formatted variations (spaces, hyphens)', async () => {
      const loan = await svc.create({
        name: 'Sofinco',
        type: 'classic',
        category: 'auto',
        monthlyPayment: 240,
        matchPattern: 'SOFINCO',
        isActive: true,
        contractRef: '12345678',
      });
      // PDF version with spaces/hyphens still matches
      expect((await svc.findByIdentifiers({ accountNumber: '1234 5678' }))?.id).toBe(loan.id);
      expect((await svc.findByIdentifiers({ accountNumber: '1234-5678' }))?.id).toBe(loan.id);
      expect((await svc.findByIdentifiers({ accountNumber: '12345678' }))?.id).toBe(loan.id);
    });

    it('falls back to rumRefs when accountNumber misses', async () => {
      const loan = await svc.create({
        name: 'Cofidis',
        type: 'revolving',
        category: 'consumer',
        monthlyPayment: 80,
        matchPattern: 'COFIDIS',
        isActive: true,
        creditor: 'COFIDIS',
        contractRef: '51215116521100',
        rumRefs: ['COFI20240315ABC'],
        maxAmount: 3000,
        usedAmount: 0,
      });
      // Statement avec RUM mais sans accountNumber (cas Cofidis typique)
      const found = await svc.findByIdentifiers({
        accountNumber: null,
        rumNumber: 'COFI20240315ABC',
      });
      expect(found?.id).toBe(loan.id);
    });

    it('falls back to rumRefs with normalized matching', async () => {
      const loan = await svc.create({
        name: 'Cofidis',
        type: 'revolving',
        category: 'consumer',
        monthlyPayment: 80,
        matchPattern: 'COFIDIS',
        isActive: true,
        rumRefs: ['COFI-2024-0315-ABC'],
        maxAmount: 3000,
        usedAmount: 0,
      });
      const found = await svc.findByIdentifiers({ rumNumber: 'COFI20240315ABC' });
      expect(found?.id).toBe(loan.id);
    });

    it('returns null when neither contractRef nor rumRefs match', async () => {
      await svc.create({
        name: 'Sofinco',
        type: 'classic',
        category: 'auto',
        monthlyPayment: 240,
        matchPattern: 'SOFINCO',
        isActive: true,
        contractRef: '12345678',
        rumRefs: ['SOFI-MAND-001'],
      });
      const found = await svc.findByIdentifiers({
        accountNumber: '99999999',
        rumNumber: 'COMPLETELY-DIFFERENT-RUM',
      });
      expect(found).toBeNull();
    });

    it('returns null when no identifiers provided', async () => {
      await svc.create({
        name: 'Cofidis',
        type: 'revolving',
        category: 'consumer',
        monthlyPayment: 80,
        matchPattern: 'COFIDIS',
        isActive: true,
        contractRef: '51215116521100',
        maxAmount: 3000,
      });
      const found = await svc.findByIdentifiers({ accountNumber: null, rumNumber: null });
      expect(found).toBeNull();
    });

    it('contractRef takes precedence over rumRefs when both could match', async () => {
      const loanA = await svc.create({
        name: 'Cofidis A',
        type: 'revolving',
        category: 'consumer',
        monthlyPayment: 80,
        matchPattern: 'COFIDIS',
        isActive: true,
        contractRef: '11111111',
        rumRefs: ['SHARED-RUM'],
        maxAmount: 3000,
      });
      await svc.create({
        name: 'Cofidis B',
        type: 'revolving',
        category: 'consumer',
        monthlyPayment: 80,
        matchPattern: 'COFIDIS',
        isActive: true,
        contractRef: '22222222',
        rumRefs: ['SHARED-RUM'], // collision RUM (théorique mais protège l'algorithme)
        maxAmount: 3000,
      });
      // Quand accountNumber identifie A : on prend A même si le RUM est dans les deux
      const found = await svc.findByIdentifiers({
        accountNumber: '11111111',
        rumNumber: 'SHARED-RUM',
      });
      expect(found?.id).toBe(loanA.id);
    });
  });

  describe('attachRumRef', () => {
    it('appends a new RUM to a loan that has none', async () => {
      const loan = await svc.create({
        name: 'Cofidis',
        type: 'revolving',
        category: 'consumer',
        monthlyPayment: 80,
        matchPattern: 'COFIDIS',
        isActive: true,
        contractRef: '51215116521100',
        maxAmount: 3000,
      });
      const updated = await svc.attachRumRef(loan.id, 'COFI20240315ABC');
      expect(updated.rumRefs).toEqual(['COFI20240315ABC']);
    });

    it('appends a second RUM (mandate renewal scenario)', async () => {
      const loan = await svc.create({
        name: 'Cofidis',
        type: 'revolving',
        category: 'consumer',
        monthlyPayment: 80,
        matchPattern: 'COFIDIS',
        isActive: true,
        rumRefs: ['COFI-MANDATE-V1'],
        maxAmount: 3000,
      });
      const updated = await svc.attachRumRef(loan.id, 'COFI-MANDATE-V2');
      expect(updated.rumRefs).toEqual(['COFI-MANDATE-V1', 'COFI-MANDATE-V2']);
    });

    it('does not duplicate when RUM already known (normalized)', async () => {
      const loan = await svc.create({
        name: 'Cofidis',
        type: 'revolving',
        category: 'consumer',
        monthlyPayment: 80,
        matchPattern: 'COFIDIS',
        isActive: true,
        rumRefs: ['COFI-MANDATE-001'],
        maxAmount: 3000,
      });
      // Same RUM reformatted (no hyphens) — should be detected as duplicate
      const updated = await svc.attachRumRef(loan.id, 'COFIMANDATE001');
      expect(updated.rumRefs).toEqual(['COFI-MANDATE-001']); // unchanged
    });

    it('rejects empty RUM', async () => {
      const loan = await svc.create({
        name: 'Cofidis',
        type: 'revolving',
        category: 'consumer',
        monthlyPayment: 80,
        matchPattern: 'COFIDIS',
        isActive: true,
        maxAmount: 3000,
      });
      await expect(svc.attachRumRef(loan.id, '   ')).rejects.toThrow();
    });
  });

  describe('detectDuplicates', () => {
    it('detects duplicates by creditor + type + monthlyPayment ±5%', async () => {
      // canonical avec contractRef
      await svc.create({
        name: 'Cofidis A', type: 'revolving', category: 'consumer',
        monthlyPayment: 80, matchPattern: 'COFIDIS', isActive: true,
        creditor: 'Cofidis', contractRef: '11111111', maxAmount: 3000, usedAmount: 0,
      });
      // dup probable : pas de contractRef, RUM seulement, monthlyPayment idem
      await svc.create({
        name: 'Cofidis B', type: 'revolving', category: 'consumer',
        monthlyPayment: 80, matchPattern: 'COFIDIS', isActive: true,
        creditor: 'Cofidis', rumRefs: ['MD2024030500001234'], maxAmount: 3000, usedAmount: 0,
      });
      const groups = await svc.detectDuplicates();
      expect(groups).toHaveLength(1);
      expect(groups[0].creditor).toBe('Cofidis');
      expect(groups[0].loans).toHaveLength(2);
      expect(groups[0].reasons.length).toBeGreaterThan(0);
    });

    it('does NOT group when contractRefs are franchement différents', async () => {
      await svc.create({
        name: 'Sofinco A', type: 'classic', category: 'auto',
        monthlyPayment: 240, matchPattern: 'SOFINCO', isActive: true,
        creditor: 'Sofinco', contractRef: '11111111',
      });
      await svc.create({
        name: 'Sofinco B', type: 'classic', category: 'auto',
        monthlyPayment: 240, matchPattern: 'SOFINCO', isActive: true,
        creditor: 'Sofinco', contractRef: '99999999', // distinct
      });
      const groups = await svc.detectDuplicates();
      expect(groups).toHaveLength(0);
    });

    it('does NOT group when payments differ more than 5%', async () => {
      await svc.create({
        name: 'Cofidis A', type: 'revolving', category: 'consumer',
        monthlyPayment: 80, matchPattern: 'COFIDIS', isActive: true,
        creditor: 'Cofidis', contractRef: '11111111', maxAmount: 3000, usedAmount: 0,
      });
      await svc.create({
        name: 'Cofidis B', type: 'revolving', category: 'consumer',
        monthlyPayment: 100, matchPattern: 'COFIDIS', isActive: true, // +25%
        creditor: 'Cofidis', maxAmount: 3000, usedAmount: 0,
      });
      const groups = await svc.detectDuplicates();
      expect(groups).toHaveLength(0);
    });

    it('skips loans without creditor (cannot dedupe blindly)', async () => {
      await svc.create({
        name: 'Crédit ?', type: 'revolving', category: 'consumer',
        monthlyPayment: 80, matchPattern: 'X', isActive: true,
        maxAmount: 3000, usedAmount: 0,
      });
      await svc.create({
        name: 'Crédit ?? bis', type: 'revolving', category: 'consumer',
        monthlyPayment: 80, matchPattern: 'X', isActive: true,
        maxAmount: 3000, usedAmount: 0,
      });
      const groups = await svc.detectDuplicates();
      expect(groups).toHaveLength(0);
    });
  });

  describe('mergeDuplicates', () => {
    it('migrates occurrences + unions rumRefs + adopts contractRef from dup', async () => {
      const canonical = await svc.create({
        name: 'Cofidis canonical', type: 'revolving', category: 'consumer',
        monthlyPayment: 80, matchPattern: 'COFIDIS', isActive: true,
        creditor: 'Cofidis', maxAmount: 3000, usedAmount: 0,
        // pas de contractRef → adoption attendue
      });
      const dup = await svc.create({
        name: 'Cofidis dup', type: 'revolving', category: 'consumer',
        monthlyPayment: 80, matchPattern: 'COFIDIS', isActive: true,
        creditor: 'Cofidis', contractRef: 'CONTRACT-X',
        rumRefs: ['RUM-A', 'RUM-B'], maxAmount: 3000, usedAmount: 0,
      });
      // Ajoute des occurrences au dup
      await svc.addOccurrence(dup.id, {
        statementId: '2026-03', date: '2026-03-15', amount: -80, transactionId: 'tx-1',
      });
      await svc.addOccurrence(dup.id, {
        statementId: '2026-04', date: '2026-04-15', amount: -80, transactionId: 'tx-2',
      });

      const merged = await svc.mergeDuplicates(canonical.id, [dup.id]);

      expect(merged.contractRef).toBe('CONTRACT-X'); // adopté
      expect(merged.rumRefs).toEqual(expect.arrayContaining(['RUM-A', 'RUM-B']));
      expect(merged.occurrencesDetected).toHaveLength(2);

      // Le dup a été supprimé
      const all = await svc.getAll();
      expect(all.find((l) => l.id === dup.id)).toBeUndefined();
      expect(all.find((l) => l.id === canonical.id)).toBeDefined();
    });

    it('dedupes occurrences by (statementId, transactionId) when both have same one', async () => {
      const canonical = await svc.create({
        name: 'Cofidis A', type: 'revolving', category: 'consumer',
        monthlyPayment: 80, matchPattern: 'COFIDIS', isActive: true,
        creditor: 'Cofidis', contractRef: '11111111', maxAmount: 3000, usedAmount: 0,
      });
      const dup = await svc.create({
        name: 'Cofidis B', type: 'revolving', category: 'consumer',
        monthlyPayment: 80, matchPattern: 'COFIDIS', isActive: true,
        creditor: 'Cofidis', maxAmount: 3000, usedAmount: 0,
      });
      // Même clé d'occurrence sur les deux
      await svc.addOccurrence(canonical.id, {
        statementId: '2026-03', date: '2026-03-15', amount: -80, transactionId: 'tx-shared',
      });
      await svc.addOccurrence(dup.id, {
        statementId: '2026-03', date: '2026-03-15', amount: -80, transactionId: 'tx-shared',
      });
      await svc.addOccurrence(dup.id, {
        statementId: '2026-04', date: '2026-04-15', amount: -80, transactionId: 'tx-only-dup',
      });

      const merged = await svc.mergeDuplicates(canonical.id, [dup.id]);
      // 1 partagée + 1 unique au dup = 2, pas 3
      expect(merged.occurrencesDetected).toHaveLength(2);
    });

    it('rejects merge when creditor differs', async () => {
      const a = await svc.create({
        name: 'Cofidis', type: 'revolving', category: 'consumer',
        monthlyPayment: 80, matchPattern: 'COFIDIS', isActive: true,
        creditor: 'Cofidis', maxAmount: 3000, usedAmount: 0,
      });
      const b = await svc.create({
        name: 'Sofinco', type: 'revolving', category: 'consumer',
        monthlyPayment: 80, matchPattern: 'SOFINCO', isActive: true,
        creditor: 'Sofinco', maxAmount: 3000, usedAmount: 0,
      });
      await expect(svc.mergeDuplicates(a.id, [b.id])).rejects.toThrow(/créancier différent/);
    });

    it('rejects when canonicalId in duplicateIds', async () => {
      const a = await svc.create({
        name: 'Cofidis', type: 'revolving', category: 'consumer',
        monthlyPayment: 80, matchPattern: 'COFIDIS', isActive: true,
        creditor: 'Cofidis', maxAmount: 3000, usedAmount: 0,
      });
      await expect(svc.mergeDuplicates(a.id, [a.id])).rejects.toThrow();
    });
  });

  describe('applyAmortizationSchedule', () => {
    it('applique le schedule + update partiel des champs canoniques', async () => {
      const loan = await svc.create({
        name: 'Auto', type: 'classic', category: 'auto',
        monthlyPayment: 200, matchPattern: 'CETELEM', isActive: true,
        creditor: 'CETELEM',
      });
      const updated = await svc.applyAmortizationSchedule(loan.id, {
        creditor: 'CETELEM',
        initialPrincipal: 12000,
        monthlyPayment: 240,
        startDate: '2026-01-01',
        endDate: '2030-12-01',
        taeg: 4.85,
        schedule: [
          { date: '2026-01-01', capitalRemaining: 11800, capitalPaid: 200, interestPaid: 40 },
          { date: '2026-02-01', capitalRemaining: 11599, capitalPaid: 201, interestPaid: 39 },
        ],
      });
      expect(updated.initialPrincipal).toBe(12000);
      expect(updated.monthlyPayment).toBe(240); // updated
      expect(updated.startDate).toBe('2026-01-01');
      expect(updated.endDate).toBe('2030-12-01');
      expect(updated.amortizationSchedule).toHaveLength(2);
      expect(updated.amortizationSchedule![0].capitalRemaining).toBe(11800);
    });

    it('rejette si schedule vide (extraction Claude foireuse)', async () => {
      const loan = await svc.create({
        name: 'Auto', type: 'classic', category: 'auto',
        monthlyPayment: 200, matchPattern: 'X', isActive: true,
      });
      await expect(svc.applyAmortizationSchedule(loan.id, {
        creditor: 'X', initialPrincipal: 1000, monthlyPayment: 100,
        startDate: '2026-01-01', endDate: '2026-12-01', taeg: null,
        schedule: [],
      })).rejects.toThrow(/Schedule vide/);
    });

    it('rejette si loan introuvable', async () => {
      await expect(svc.applyAmortizationSchedule('does-not-exist', {
        creditor: 'X', initialPrincipal: 1000, monthlyPayment: 100,
        startDate: '2026-01-01', endDate: '2026-12-01', taeg: null,
        schedule: [{ date: '2026-01-01', capitalRemaining: 900, capitalPaid: 100, interestPaid: 10 }],
      })).rejects.toThrow(/introuvable/);
    });

    it("rejette si le loan n'est pas classique (revolving n'a pas de tableau)", async () => {
      const loan = await svc.create({
        name: 'Cofidis', type: 'revolving', category: 'consumer',
        monthlyPayment: 80, matchPattern: 'COFIDIS', isActive: true,
        maxAmount: 3000, usedAmount: 0,
      });
      await expect(svc.applyAmortizationSchedule(loan.id, {
        creditor: 'COFIDIS', initialPrincipal: 3000, monthlyPayment: 80,
        startDate: '2026-01-01', endDate: '2030-12-01', taeg: 19.84,
        schedule: [{ date: '2026-01-01', capitalRemaining: 2920, capitalPaid: 80, interestPaid: 30 }],
      })).rejects.toThrow(/classique/);
    });

    it('trie le schedule chronologiquement même si Claude renvoie désordonné', async () => {
      const loan = await svc.create({
        name: 'Auto', type: 'classic', category: 'auto',
        monthlyPayment: 200, matchPattern: 'X', isActive: true,
      });
      const updated = await svc.applyAmortizationSchedule(loan.id, {
        creditor: 'X', initialPrincipal: 600, monthlyPayment: 200,
        startDate: '2026-01-01', endDate: '2026-03-01', taeg: 2.0,
        schedule: [
          { date: '2026-03-01', capitalRemaining: 0, capitalPaid: 200, interestPaid: 1 },
          { date: '2026-01-01', capitalRemaining: 400, capitalPaid: 200, interestPaid: 3 },
          { date: '2026-02-01', capitalRemaining: 200, capitalPaid: 200, interestPaid: 2 },
        ],
      });
      expect(updated.amortizationSchedule!.map((l) => l.date)).toEqual([
        '2026-01-01', '2026-02-01', '2026-03-01',
      ]);
    });

    it('preserve le creditor existant si déjà défini (user a la main)', async () => {
      const loan = await svc.create({
        name: 'Auto perso', type: 'classic', category: 'auto',
        monthlyPayment: 200, matchPattern: 'X', isActive: true,
        creditor: 'Mon nom personnalisé',
      });
      const updated = await svc.applyAmortizationSchedule(loan.id, {
        creditor: 'CETELEM',
        initialPrincipal: 1000, monthlyPayment: 100,
        startDate: '2026-01-01', endDate: '2026-10-01', taeg: 4.85,
        schedule: [{ date: '2026-01-01', capitalRemaining: 900, capitalPaid: 100, interestPaid: 5 }],
      });
      expect(updated.creditor).toBe('Mon nom personnalisé');
    });
  });
});
