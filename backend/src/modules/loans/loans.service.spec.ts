import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LoansService } from './loans.service';
import { EventBusService } from '../events/event-bus.service';
import { RequestDataDirService } from '../demo/request-data-dir.service';
import { StorageService } from '../storage/storage.service';
import type { Loan } from '../../models/loan.model';
import type { MonthlyStatement } from '../../models/monthly-statement.model';

describe('LoansService', () => {
  let svc: LoansService;
  let tmpDir: string;
  let storageStmts: MonthlyStatement[];

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-loans-'));
    storageStmts = [];
    const mod = await Test.createTestingModule({
      providers: [
        LoansService,
        { provide: RequestDataDirService, useValue: { getDataDir: () => tmpDir, isDemoMode: () => false, runWith: (_ctx: any, fn: any) => fn() } },
        { provide: EventBusService, useValue: { emit: jest.fn() } },
        { provide: StorageService, useValue: { getAllStatements: jest.fn(async () => storageStmts) } },
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

    it('findExistingLoan — high confidence on contractRef', async () => {
      const loan = await svc.create({
        name: 'X', type: 'classic', category: 'auto',
        monthlyPayment: 100, matchPattern: 'X', isActive: true,
        creditor: 'CETELEM', contractRef: '12345678',
      });
      const result = await svc.findExistingLoan({ contractRef: '1234-5678' });
      expect(result?.loan.id).toBe(loan.id);
      expect(result?.confidence).toBe('high');
      expect(result?.reason).toMatch(/contractRef/);
    });

    it('findExistingLoan — high confidence on rumNumber fallback', async () => {
      const loan = await svc.create({
        name: 'X', type: 'revolving', category: 'consumer',
        monthlyPayment: 80, matchPattern: 'COFIDIS', isActive: true,
        rumRefs: ['MD2024030500001234'], maxAmount: 3000,
      });
      const result = await svc.findExistingLoan({ rumNumber: 'MD2024030500001234' });
      expect(result?.loan.id).toBe(loan.id);
      expect(result?.confidence).toBe('high');
    });

    it('findExistingLoan — medium confidence on creditor + monthlyAmount ±5%', async () => {
      const loan = await svc.create({
        name: 'X', type: 'classic', category: 'auto',
        monthlyPayment: 100, matchPattern: 'X', isActive: true,
        creditor: 'SOFINCO',
      });
      const result = await svc.findExistingLoan({ creditor: 'sofinco', monthlyAmount: 102 });
      expect(result?.loan.id).toBe(loan.id);
      expect(result?.confidence).toBe('medium');
    });

    it('findExistingLoan — low confidence on description regex match', async () => {
      const loan = await svc.create({
        name: 'X', type: 'classic', category: 'auto',
        monthlyPayment: 100, matchPattern: 'PRELEVT.*COFIDIS', isActive: true,
      });
      const result = await svc.findExistingLoan({ description: 'PRELEVT MENSUEL COFIDIS REF XYZ' });
      expect(result?.loan.id).toBe(loan.id);
      expect(result?.confidence).toBe('low');
    });

    it('findExistingLoan — null si aucun signal ne matche', async () => {
      await svc.create({
        name: 'X', type: 'classic', category: 'auto',
        monthlyPayment: 100, matchPattern: 'X', isActive: true,
        creditor: 'CETELEM', contractRef: '11111111',
      });
      const result = await svc.findExistingLoan({
        contractRef: '99999999',
        rumNumber: 'WRONG',
        creditor: 'OTHER-CREDITOR',
        monthlyAmount: 999,
        description: 'SOMETHING UNRELATED',
      });
      expect(result).toBeNull();
    });

    it('findExistingLoan — high (contractRef) prioritaire sur medium (creditor+amount)', async () => {
      const loanA = await svc.create({
        name: 'A', type: 'classic', category: 'auto',
        monthlyPayment: 100, matchPattern: 'X', isActive: true,
        creditor: 'CETELEM', contractRef: '11111111',
      });
      // loan B avec mêmes creditor + amount mais contractRef différent
      await svc.create({
        name: 'B', type: 'classic', category: 'auto',
        monthlyPayment: 100, matchPattern: 'Y', isActive: true,
        creditor: 'CETELEM', contractRef: '22222222',
      });
      // signal pointe vers contractRef A — doit gagner même si creditor+amount matchent les 2
      const result = await svc.findExistingLoan({
        contractRef: '11111111', creditor: 'CETELEM', monthlyAmount: 100,
      });
      expect(result?.loan.id).toBe(loanA.id);
      expect(result?.confidence).toBe('high');
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

    it('flags 2 loans actifs partageant un mois d\'occurrence comme doublon (invariant 1 débit/mois max)', async () => {
      // 2 Cofidis avec mensualités franchement différentes (>5%) — normalement
      // pas dedup. Mais ils ont une occurrence dans le MÊME mois → invariant
      // violé : forcément le même crédit.
      const a = await svc.create({
        name: 'Cofidis A', type: 'revolving', category: 'consumer',
        monthlyPayment: 80, matchPattern: 'COFIDIS', isActive: true,
        creditor: 'Cofidis', maxAmount: 3000, usedAmount: 0,
      });
      const b = await svc.create({
        name: 'Cofidis B', type: 'revolving', category: 'consumer',
        monthlyPayment: 110, matchPattern: 'COFIDIS', isActive: true, // +37%
        creditor: 'Cofidis', maxAmount: 3000, usedAmount: 0,
      });
      await svc.addOccurrence(a.id, { statementId: '2026-04', date: '2026-04-15', amount: -80, transactionId: 'tx-1' });
      await svc.addOccurrence(b.id, { statementId: '2026-04', date: '2026-04-20', amount: -110, transactionId: 'tx-2' });
      const groups = await svc.detectDuplicates();
      expect(groups).toHaveLength(1);
      expect(groups[0].loans).toHaveLength(2);
      expect(groups[0].reasons.some((r) => /Invariant viol|même mois|1 débit\/mois/i.test(r))).toBe(true);
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

  describe('getLoanKind + installment kind', () => {
    it('getLoanKind retourne kind explicite si présent', () => {
      const loan = { kind: 'installment', type: 'classic' } as Loan;
      expect(LoansService.getLoanKind(loan)).toBe('installment');
    });

    it('getLoanKind fallback sur type pour les loans pré-APEX 05', () => {
      const classicLegacy = { type: 'classic' } as Loan;
      const revolvingLegacy = { type: 'revolving' } as Loan;
      expect(LoansService.getLoanKind(classicLegacy)).toBe('classic');
      expect(LoansService.getLoanKind(revolvingLegacy)).toBe('revolving');
    });

    it('markInstallmentPaid marque la ligne + paidOccurrenceId', async () => {
      const loan = await svc.create({
        name: '4× COFIDIS · AMAZON', type: 'classic', kind: 'installment',
        category: 'consumer', monthlyPayment: 65.81, matchPattern: 'COFIDIS', isActive: true,
        creditor: 'COFIDIS',
        installmentSchedule: [
          { dueDate: '2025-11-02', amount: 65.81, paid: false },
          { dueDate: '2025-12-03', amount: 65.81, paid: false },
        ],
      });
      const updated = await svc.markInstallmentPaid(loan.id, 0, 'occ-abc');
      expect(updated.installmentSchedule![0].paid).toBe(true);
      expect(updated.installmentSchedule![0].paidOccurrenceId).toBe('occ-abc');
      expect(updated.installmentSchedule![1].paid).toBe(false);
    });

    it('markInstallmentPaid est idempotent', async () => {
      const loan = await svc.create({
        name: '4× COFIDIS', type: 'classic', kind: 'installment',
        category: 'consumer', monthlyPayment: 65.81, matchPattern: 'COFIDIS', isActive: true,
        creditor: 'COFIDIS',
        installmentSchedule: [{ dueDate: '2025-11-02', amount: 65.81, paid: true, paidOccurrenceId: 'X' }],
      });
      const same = await svc.markInstallmentPaid(loan.id, 0, 'Y');
      // No change because already paid
      expect(same.installmentSchedule![0].paidOccurrenceId).toBe('X');
    });

    it('getLoanHealth installment : complete si toutes past dueDates paid', () => {
      const loan = {
        kind: 'installment',
        type: 'classic',
        installmentSchedule: [
          { dueDate: '2025-11-02', amount: 65, paid: true },
          { dueDate: '2025-12-03', amount: 65, paid: true },
          { dueDate: '2026-06-03', amount: 65, paid: false }, // future
        ],
        occurrencesDetected: [],
      } as any;
      expect(LoansService.getLoanHealth(loan, '2026-01-15')).toBe('complete');
    });

    it('getLoanHealth installment : partial si quelques past dueDates paid', () => {
      const loan = {
        kind: 'installment',
        type: 'classic',
        installmentSchedule: [
          { dueDate: '2025-11-02', amount: 65, paid: true },
          { dueDate: '2025-12-03', amount: 65, paid: false },
        ],
        occurrencesDetected: [],
      } as any;
      expect(LoansService.getLoanHealth(loan, '2026-01-15')).toBe('partial');
    });

    it('getLoanHealth installment : partial (pas gap) si 0 paid — relevés bancaires manquent', () => {
      // Cas du contrat fraîchement importé sans relevé bancaire matchant :
      // matcher rétroactif n'a rien trouvé → schedule reste à 0/N paid.
      // Doit afficher PARTIEL (jaune) plutôt que TROU (rouge), car ce n'est
      // pas un problème — juste un manque d'info.
      const loan = {
        kind: 'installment',
        type: 'classic',
        installmentSchedule: [
          { dueDate: '2025-11-02', amount: 65, paid: false },
          { dueDate: '2025-12-03', amount: 65, paid: false },
          { dueDate: '2026-01-03', amount: 65, paid: false },
          { dueDate: '2026-02-03', amount: 65, paid: false },
        ],
        occurrencesDetected: [],
      } as any;
      expect(LoansService.getLoanHealth(loan, '2026-05-10')).toBe('partial');
    });

    it('getSuspiciousLoans skip les kind=installment (légitimes)', async () => {
      await svc.create({
        name: 'COFIDIS 4XCB AMAZON', type: 'classic', kind: 'installment',
        category: 'consumer', monthlyPayment: 65.81, matchPattern: 'COFIDIS', isActive: true,
        creditor: 'COFIDIS',
        installmentSchedule: [
          { dueDate: '2025-11-02', amount: 65.81, paid: true },
          { dueDate: '2025-12-03', amount: 65.81, paid: true },
        ],
      });
      const suspicious = await svc.getSuspiciousLoans('2026-05-10');
      // Devrait être 0 — l'installment est légitime même avec name match pay-in-N
      expect(suspicious).toHaveLength(0);
    });
  });

  describe('getSuspiciousLoans + cleanupSuspiciousLoans', () => {
    it('détecte un loan dont le name match pay-in-N (4X CB AMAZON)', async () => {
      await svc.create({
        name: 'COFIDIS 4X CB AMAZON', type: 'classic', category: 'consumer',
        monthlyPayment: 80, matchPattern: 'COFIDIS', isActive: true,
        creditor: 'COFIDIS',
      });
      const suspicious = await svc.getSuspiciousLoans('2026-05-10');
      expect(suspicious).toHaveLength(1);
      expect(suspicious[0].reason).toMatch(/pay-in-N/);
    });

    it('détecte un loan avec ≤4 occurrences sur ≤4 mois consécutifs et arrêté ≥60j', async () => {
      const loan = await svc.create({
        name: 'OBSCUR', type: 'classic', category: 'consumer',
        monthlyPayment: 50, matchPattern: 'X', isActive: true,
      });
      // 3 occurrences sur 3 mois (jan, fev, mar 2026), aucune depuis = arrêté
      await svc.addOccurrence(loan.id, { statementId: 's1', date: '2026-01-15', amount: -50, transactionId: null });
      await svc.addOccurrence(loan.id, { statementId: 's2', date: '2026-02-15', amount: -50, transactionId: null });
      await svc.addOccurrence(loan.id, { statementId: 's3', date: '2026-03-15', amount: -50, transactionId: null });
      const suspicious = await svc.getSuspiciousLoans('2026-05-20'); // > 60 jours après dernière
      expect(suspicious.length).toBeGreaterThanOrEqual(1);
      const me = suspicious.find((s) => s.id === loan.id);
      expect(me?.reason).toMatch(/typique pay-in-N/);
    });

    it('NE détecte PAS un loan actif (occurrence récente)', async () => {
      const loan = await svc.create({
        name: 'CETELEM ECHEANCE', type: 'classic', category: 'auto',
        monthlyPayment: 240, matchPattern: 'CETELEM', isActive: true,
      });
      await svc.addOccurrence(loan.id, { statementId: 's1', date: '2026-04-15', amount: -240, transactionId: null });
      await svc.addOccurrence(loan.id, { statementId: 's2', date: '2026-05-15', amount: -240, transactionId: null });
      const suspicious = await svc.getSuspiciousLoans('2026-05-20');
      expect(suspicious.find((s) => s.id === loan.id)).toBeUndefined();
    });

    it('cleanupSuspiciousLoans supprime en bulk les IDs fournis', async () => {
      const a = await svc.create({
        name: 'A', type: 'classic', category: 'consumer', monthlyPayment: 50, matchPattern: 'A', isActive: true,
      });
      const b = await svc.create({
        name: 'B', type: 'classic', category: 'consumer', monthlyPayment: 50, matchPattern: 'B', isActive: true,
      });
      const c = await svc.create({
        name: 'C', type: 'classic', category: 'consumer', monthlyPayment: 50, matchPattern: 'C', isActive: true,
      });
      const result = await svc.cleanupSuspiciousLoans([a.id, c.id]);
      expect(result.deletedCount).toBe(2);
      const remaining = await svc.getAll();
      expect(remaining.map((l) => l.id)).toEqual([b.id]);
    });

    it('cleanupSuspiciousLoans rejette si aucun ID ne correspond', async () => {
      await expect(svc.cleanupSuspiciousLoans(['does-not-exist'])).rejects.toThrow(/Aucun/);
    });

    it('critère 3 : signale un loan actif absent du dernier relevé (invariant)', async () => {
      // Setup : un statement de mai 2026 dans storage
      storageStmts.push({
        id: 'stmt-2026-05',
        month: 5,
        year: 2026,
        uploadedAt: '2026-05-10T00:00:00Z',
        bankName: 'LBP',
        accountHolder: 'Sylvain',
        currency: 'EUR',
        openingBalance: 0,
        closingBalance: 0,
        totalCredits: 0,
        totalDebits: 0,
        transactions: [],
        healthScore: { score: 0, label: 'ok', explanation: '', strengths: [], weaknesses: [] } as any,
        recurringCredits: [],
        analysisNarrative: '',
      });
      // Loan actif avec startDate avant le relevé MAIS aucune occurrence
      const ghost = await svc.create({
        name: 'GHOST CREDIT', type: 'classic', category: 'consumer',
        monthlyPayment: 200, matchPattern: 'GHOST', isActive: true,
        creditor: 'Cetelem', startDate: '2025-11-01',
      });
      // Loan avec occurrence dans le mois courant → OK
      const ok = await svc.create({
        name: 'OK CREDIT', type: 'classic', category: 'consumer',
        monthlyPayment: 150, matchPattern: 'OK', isActive: true,
        creditor: 'Sofinco', startDate: '2025-11-01',
      });
      await svc.addOccurrence(ok.id, { statementId: 'stmt-2026-05', date: '2026-05-03', amount: -150, transactionId: 'tx-ok' });
      // Loan avec startDate posterieur au relevé → faux positif exclu
      await svc.create({
        name: 'FRESH', type: 'classic', category: 'consumer',
        monthlyPayment: 90, matchPattern: 'FRESH', isActive: true,
        creditor: 'Cofidis', startDate: '2026-06-01',
      });

      const suspicious = await svc.getSuspiciousLoans('2026-05-15');
      const ghostFound = suspicious.find((s) => s.id === ghost.id);
      expect(ghostFound).toBeDefined();
      expect(ghostFound!.reason).toMatch(/Absent du dernier relevé/);
      expect(suspicious.find((s) => s.id === ok.id)).toBeUndefined();
      // FRESH ne doit pas être listé non plus (startDate > lastStmtMonth)
      expect(suspicious.find((s) => s.name === 'FRESH')).toBeUndefined();
    });
  });

  describe('convertToInstallment', () => {
    it('convertit un classic suspect en kind=installment, schedule depuis occurrences', async () => {
      const loan = await svc.create({
        name: 'COFIDIS 4X CB AMAZON', type: 'classic', category: 'consumer',
        monthlyPayment: 65.81, matchPattern: 'COFIDIS', isActive: true,
        creditor: 'COFIDIS',
      });
      await svc.addOccurrence(loan.id, { statementId: 's-2025-11', date: '2025-11-02', amount: -65.81, transactionId: null });
      await svc.addOccurrence(loan.id, { statementId: 's-2025-12', date: '2025-12-03', amount: -65.81, transactionId: null });
      await svc.addOccurrence(loan.id, { statementId: 's-2026-01', date: '2026-01-04', amount: -65.81, transactionId: null });
      await svc.addOccurrence(loan.id, { statementId: 's-2026-02', date: '2026-02-03', amount: -65.81, transactionId: null });

      const converted = await svc.convertToInstallment(loan.id);

      expect(converted.kind).toBe('installment');
      expect(converted.installmentSchedule).toHaveLength(4);
      expect(converted.installmentSchedule![0]).toMatchObject({
        dueDate: '2025-11-02',
        amount: 65.81,
        paid: true,
        paidOccurrenceId: 's-2025-11',
      });
      expect(converted.installmentMerchant).toBe('COFIDIS');
      expect(converted.installmentSignatureDate).toBe('2025-11-02');
    });

    it('désactive le loan si toutes les échéances sont passées', async () => {
      const loan = await svc.create({
        name: 'PAY 3X', type: 'classic', category: 'consumer',
        monthlyPayment: 100, matchPattern: 'PAY', isActive: true,
      });
      await svc.addOccurrence(loan.id, { statementId: 's1', date: '2025-10-01', amount: -100, transactionId: null });
      await svc.addOccurrence(loan.id, { statementId: 's2', date: '2025-11-01', amount: -100, transactionId: null });
      await svc.addOccurrence(loan.id, { statementId: 's3', date: '2025-12-01', amount: -100, transactionId: null });

      const converted = await svc.convertToInstallment(loan.id);
      // toutes < today (2026-05-10 dans le test runner)
      expect(converted.isActive).toBe(false);
      expect(converted.endDate).toBe('2025-12-01');
    });

    it('rejette la conversion si le loan n\'a aucune occurrence', async () => {
      const loan = await svc.create({
        name: 'EMPTY', type: 'classic', category: 'consumer',
        monthlyPayment: 50, matchPattern: 'X', isActive: true,
      });
      await expect(svc.convertToInstallment(loan.id)).rejects.toThrow(/sans occurrence/);
    });

    it('rejette la conversion si le loan n\'existe pas', async () => {
      await expect(svc.convertToInstallment('does-not-exist')).rejects.toThrow(/introuvable/);
    });
  });

  describe('getLoanHealth', () => {
    const today = '2026-05-10';
    const recent = '2026-04-15';
    const old = '2025-09-15';

    it('complete : amortization + ≥3 occurrences récentes', () => {
      const loan = {
        amortizationSchedule: [{ date: '2024-06-01', capitalRemaining: 100, capitalPaid: 10, interestPaid: 1 }],
        occurrencesDetected: [
          { id: '1', statementId: 's', date: '2026-03-01', amount: -100, transactionId: null },
          { id: '2', statementId: 's', date: '2026-04-01', amount: -100, transactionId: null },
          { id: '3', statementId: 's', date: '2026-05-01', amount: -100, transactionId: null },
        ],
      } as any;
      expect(LoansService.getLoanHealth(loan, today)).toBe('complete');
    });

    it('complete : statement récent + ≥3 occurrences récentes (sans amortization)', () => {
      const loan = {
        lastStatementSnapshot: { date: recent, source: 'pdf-import', extractedValues: {} },
        occurrencesDetected: [
          { id: '1', statementId: 's', date: '2026-03-01', amount: -100, transactionId: null },
          { id: '2', statementId: 's', date: '2026-04-01', amount: -100, transactionId: null },
          { id: '3', statementId: 's', date: '2026-05-01', amount: -100, transactionId: null },
        ],
      } as any;
      expect(LoansService.getLoanHealth(loan, today)).toBe('complete');
    });

    it('partial : amortization mais 0 occurrence récente', () => {
      const loan = {
        amortizationSchedule: [{ date: '2024-06-01', capitalRemaining: 100, capitalPaid: 10, interestPaid: 1 }],
        occurrencesDetected: [
          { id: '1', statementId: 's', date: '2024-09-01', amount: -100, transactionId: null }, // hors fenêtre 6 mois
        ],
      } as any;
      expect(LoansService.getLoanHealth(loan, today)).toBe('partial');
    });

    it('partial : pas de schedule ni de statement récent, mais 2 occurrences récentes', () => {
      const loan = {
        occurrencesDetected: [
          { id: '1', statementId: 's', date: '2026-04-01', amount: -100, transactionId: null },
          { id: '2', statementId: 's', date: '2026-05-01', amount: -100, transactionId: null },
        ],
      } as any;
      expect(LoansService.getLoanHealth(loan, today)).toBe('partial');
    });

    it('gap : pas de schedule, pas de statement récent, ≤1 occurrence', () => {
      const loan = {
        lastStatementSnapshot: { date: old, source: 'pdf-import', extractedValues: {} },
        occurrencesDetected: [],
      } as any;
      expect(LoansService.getLoanHealth(loan, today)).toBe('gap');
    });
  });

  describe('mergeLoanPatch — règles priorité par source', () => {
    it('credit_statement update startDate si vide (avant : ne le faisait pas)', async () => {
      const loan = await svc.create({
        name: 'X', type: 'classic', category: 'auto',
        monthlyPayment: 100, matchPattern: 'X', isActive: true,
        // pas de startDate
      });
      await svc.applyStatementSnapshot(loan.id, {
        creditor: 'CETELEM', creditType: 'classic',
        currentBalance: 5000, monthlyPayment: 240,
        endDate: '2030-01-01', taeg: 4.85,
        statementDate: '2026-03-15',
      });
      // Avant le refactor: startDate restait undefined. Après : on n'auto-fill
      // pas startDate depuis credit_statement (ce serait approximatif). Il
      // faut un user edit OU un import amortization pour startDate.
      const updated = await svc.getOne(loan.id);
      expect(updated.startDate).toBeUndefined();
    });

    it('amortization écrase startDate même si déjà set par user', async () => {
      const loan = await svc.create({
        name: 'X', type: 'classic', category: 'auto',
        monthlyPayment: 100, matchPattern: 'X', isActive: true,
        startDate: '2025-01-01', // user-set
      });
      await svc.applyAmortizationSchedule(loan.id, {
        creditor: 'CETELEM', initialPrincipal: 12000, monthlyPayment: 240,
        startDate: '2024-06-01', endDate: '2028-05-01', taeg: 4.85,
        schedule: [{ date: '2024-06-01', capitalRemaining: 11800, capitalPaid: 200, interestPaid: 40 }],
      });
      // amortization gagne — la vraie date issue du tableau est canonique
      const updated = await svc.getOne(loan.id);
      expect(updated.startDate).toBe('2024-06-01');
    });

    it('credit_statement préserve un creditor déjà set par user', async () => {
      const loan = await svc.create({
        name: 'Mon nom perso', type: 'classic', category: 'auto',
        monthlyPayment: 100, matchPattern: 'X', isActive: true,
        creditor: 'Nom à moi', // user-set
      });
      await svc.applyStatementSnapshot(loan.id, {
        creditor: 'CETELEM', creditType: 'classic',
        currentBalance: 5000, monthlyPayment: 240,
        endDate: null, taeg: 4.85, statementDate: '2026-03-15',
      });
      const updated = await svc.getOne(loan.id);
      expect(updated.creditor).toBe('Nom à moi');
    });

    it('amortization n\'écrase pas usedAmount d\'un revolving (revolving non concerné)', async () => {
      // Note : amortization rejete les revolving via une exception, mais
      // structurellement mergeLoanPatch ne devrait jamais écrire usedAmount
      // depuis 'amortization' source.
      const loan = await svc.create({
        name: 'C', type: 'revolving', category: 'consumer',
        monthlyPayment: 80, matchPattern: 'COFIDIS', isActive: true,
        maxAmount: 3000, usedAmount: 1500,
      });
      // Direct call mergeLoanPatch (bypass applyAmortizationSchedule qui throw)
      // On simule le cas où qq'un appelle mergeLoanPatch avec amortization
      // sur un revolving — usedAmount NE DOIT PAS être affecté.
      LoansService.mergeLoanPatch(loan, { usedAmount: 9999 }, 'amortization');
      // unchanged because amortization can't write usedAmount
      expect(loan.usedAmount).toBe(1500);
    });

    it('rumRefs sont additifs (union dédup) entre sources', async () => {
      const loan = await svc.create({
        name: 'X', type: 'revolving', category: 'consumer',
        monthlyPayment: 80, matchPattern: 'X', isActive: true,
        rumRefs: ['MD-001'], maxAmount: 3000,
      });
      LoansService.mergeLoanPatch(loan, { rumRefs: ['MD-002'] }, 'credit_statement');
      LoansService.mergeLoanPatch(loan, { rumRefs: ['MD002'] }, 'bank_statement'); // dup norm
      LoansService.mergeLoanPatch(loan, { rumRefs: ['MD-003'] }, 'suggestion');
      expect(loan.rumRefs).toEqual(['MD-001', 'MD-002', 'MD-003']);
    });

    it('user override: peut écraser creditor même si déjà set', async () => {
      const loan = await svc.create({
        name: 'X', type: 'classic', category: 'auto',
        monthlyPayment: 100, matchPattern: 'X', isActive: true,
        creditor: 'Existant',
      });
      LoansService.mergeLoanPatch(loan, { creditor: 'Nouveau' }, 'user');
      expect(loan.creditor).toBe('Nouveau');
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
