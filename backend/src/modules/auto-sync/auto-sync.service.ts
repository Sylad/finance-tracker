import { Injectable, Logger } from '@nestjs/common';
import { SavingsService } from '../savings/savings.service';
import { LoansService } from '../loans/loans.service';
import { LoanSuggestionsService } from '../loan-suggestions/loan-suggestions.service';
import { StorageService } from '../storage/storage.service';
import { EventBusService } from '../events/event-bus.service';
import { MonthlyStatement } from '../../models/monthly-statement.model';
import { Transaction } from '../../models/transaction.model';
import { SavingsAccount } from '../../models/savings-account.model';
import type { IncomingSuggestion } from '../../models/loan-suggestion.model';

function normalizeAccountNumber(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/[^0-9A-Z]/gi, '').toUpperCase();
}

@Injectable()
export class AutoSyncService {
  private readonly logger = new Logger(AutoSyncService.name);

  constructor(
    private readonly savings: SavingsService,
    private readonly loans: LoansService,
    private readonly suggestions: LoanSuggestionsService,
    private readonly storage: StorageService,
    private readonly bus: EventBusService,
  ) {}

  async syncStatement(statement: MonthlyStatement, claudeSuggestions: IncomingSuggestion[] = []): Promise<void> {
    await this.autoDiscoverSavings(statement);
    await this.syncSavings(statement);
    await this.syncLoans(statement);
    if (claudeSuggestions.length > 0) {
      await this.suggestions.upsertMany(statement.id, claudeSuggestions);
    }
    await this.autoCreateLoansFromSuggestions();
    await this.autoDeactivateStaleLoans();
    this.bus.emit('accounts-synced');
  }

  /**
   * Re-évalue le statut actif/inactif de tous les crédits sans avoir besoin
   * de ré-importer un PDF. Utile après un changement de seuil ou pour rafraîchir
   * manuellement.
   */
  async recomputeLoanStatuses(): Promise<{ deactivated: number }> {
    const before = (await this.loans.getAll()).filter((l) => l.isActive).length;
    await this.autoDeactivateStaleLoans();
    const after = (await this.loans.getAll()).filter((l) => l.isActive).length;
    this.bus.emit('accounts-synced');
    return { deactivated: before - after };
  }

  /**
   * Auto-discovery : pour chaque compte épargne externe affiché dans le PDF qui n'est
   * pas encore connu (par accountNumber), on le crée avec defaults intelligents.
   */
  private async autoDiscoverSavings(statement: MonthlyStatement): Promise<void> {
    const externals = statement.externalAccountBalances ?? [];
    for (const eb of externals) {
      if (!eb.accountNumber || eb.balance == null) continue;
      try {
        const result = await this.savings.upsertFromBankExtract(eb, statement.month, statement.year);
        if (result.created) {
          this.logger.log(`Auto-discovered savings account: ${result.account.name} (${eb.accountType})`);
        }
      } catch (e) {
        this.logger.warn(`Failed to auto-discover savings for accountNumber=${eb.accountNumber}: ${(e as Error).message}`);
      }
    }
  }

  async removeForStatement(statementId: string): Promise<void> {
    await this.savings.removeMovementsForStatement(statementId);
    await this.loans.removeOccurrencesForStatement(statementId);
    this.bus.emit('accounts-synced');
  }

  private async syncSavings(statement: MonthlyStatement): Promise<void> {
    const accounts = await this.savings.getAll();
    const externalBalances = statement.externalAccountBalances ?? [];

    for (const acc of accounts) {
      let handled = false;

      // Priority 1: bank-extract recalibration (if account has an accountNumber)
      if (acc.accountNumber) {
        const normAcc = normalizeAccountNumber(acc.accountNumber);
        const match = externalBalances.find(
          (eb) => normalizeAccountNumber(eb.accountNumber) === normAcc,
        );
        if (match) {
          // Idempotence: skip if a bank-extract movement for this statement already exists
          const alreadyDone = acc.movements.some(
            (m) => m.source === 'bank-extract' && m.statementId === statement.id,
          );
          if (!alreadyDone) {
            const delta = Math.round((match.balance - acc.currentBalance) * 100) / 100;
            await this.savings.addMovement(acc.id, {
              date: match.asOfDate ?? `${statement.year}-${String(statement.month).padStart(2, '0')}-01`,
              amount: delta,
              source: 'bank-extract',
              statementId: statement.id,
              transactionId: null,
              note: 'Solde recalibré depuis le relevé',
            });
          }
          await this.maybeAddInterest(acc, statement);
          handled = true;
        }
      }

      if (handled) continue;

      // Priority 2: match by targetAccountNumber on transactions
      if (acc.accountNumber) {
        const normAcc = normalizeAccountNumber(acc.accountNumber);
        const txMatches = statement.transactions.filter(
          (t) => t.targetAccountNumber && normalizeAccountNumber(t.targetAccountNumber) === normAcc,
        );
        if (txMatches.length > 0) {
          for (const t of txMatches) {
            const epargneAmount = -t.amount;
            await this.safeAddMovement(acc, t, epargneAmount, statement.id);
          }
          await this.maybeAddInterest(acc, statement);
          handled = true;
        }
      }

      if (handled) continue;

      // Priority 3: regex fallback
      if (!acc.matchPattern) {
        await this.maybeAddInterest(acc, statement);
        continue;
      }
      let regex: RegExp;
      try {
        regex = new RegExp(acc.matchPattern, 'i');
      } catch (e) {
        this.logger.warn(`Invalid regex on savings ${acc.id}: ${acc.matchPattern}`);
        await this.maybeAddInterest(acc, statement);
        continue;
      }
      const matches = statement.transactions.filter((t) => regex.test(t.description));
      for (const t of matches) {
        // Convention : un débit côté courant (amount<0) = dépôt sur compte épargne (+).
        const epargneAmount = -t.amount;
        await this.safeAddMovement(acc, t, epargneAmount, statement.id);
      }
      await this.maybeAddInterest(acc, statement);
    }
  }

  private async safeAddMovement(acc: SavingsAccount, t: Transaction, amount: number, statementId: string): Promise<void> {
    const dup = acc.movements.some((m) => m.statementId === statementId && m.transactionId === t.id);
    if (dup) return;
    await this.savings.addMovement(acc.id, {
      date: t.date,
      amount,
      source: 'detected',
      statementId,
      transactionId: t.id,
      note: `Auto: ${t.description}`,
    });
  }

  private async maybeAddInterest(acc: SavingsAccount, statement: MonthlyStatement): Promise<void> {
    if (statement.month !== acc.interestAnniversaryMonth) return;
    const alreadyDone = acc.movements.some((m) => m.source === 'interest' && m.date.startsWith(`${statement.year}-`));
    if (alreadyDone) return;
    // Estimation simple : balance courante × taux annuel.
    const interest = Math.round(acc.currentBalance * acc.interestRate * 100) / 100;
    if (interest <= 0) return;
    await this.savings.addMovement(acc.id, {
      date: `${statement.year}-${String(statement.month).padStart(2, '0')}-31`,
      amount: interest,
      source: 'interest',
      statementId: statement.id,
      transactionId: null,
      note: `Intérêts ${statement.year} (${(acc.interestRate * 100).toFixed(2)}%)`,
    });
  }

  private async syncLoans(statement: MonthlyStatement): Promise<void> {
    const loans = await this.loans.getAll();
    for (const loan of loans) {
      if (!loan.isActive) continue;

      // Build a matcher. We combine signals:
      // - At least ONE of (contractRef, rumRefs[]) must appear in description
      //   (substring, case-insensitive). RUMs are critical for Cofidis/Sofinco
      //   relevés bank where contractRef is absent.
      // - AND if matchPattern is set, the regex must also match
      // - if neither identifier nor regex set, the loan can't be auto-synced
      let regex: RegExp | null = null;
      if (loan.matchPattern) {
        try { regex = new RegExp(loan.matchPattern, 'i'); }
        catch { this.logger.warn(`Invalid regex on loan ${loan.id}: ${loan.matchPattern}`); continue; }
      }
      // Aggregate all known identifiers (contractRef + rumRefs) in lowercase
      // form. They are an OR-set : any one of them present in the transaction
      // description is enough.
      const identifiers: string[] = [];
      if (loan.contractRef) identifiers.push(loan.contractRef);
      if (loan.rumRefs) identifiers.push(...loan.rumRefs);
      const normalizedIds = identifiers
        .map((s) => s.toLowerCase().trim())
        .filter((s) => s.length >= 4); // évite faux matchs sur fragments courts
      if (normalizedIds.length === 0 && !regex) continue;
      const matcher = (desc: string): boolean => {
        const lower = desc.toLowerCase();
        if (normalizedIds.length > 0 && !normalizedIds.some((id) => lower.includes(id))) {
          return false;
        }
        if (regex && !regex.test(desc)) return false;
        return true;
      };

      // Anti-pattern: exclude card / immediate-debit transactions that match
      // the regex but are NOT credit repayments. Common LBP/Carrefour Banque
      // labels: 'PRLV COMPTANT IMMEDIAT', 'PRELEVT COMPTANT', 'CB <merchant>',
      // 'PAIEMENT CB'.
      const NOT_A_CREDIT = /\b(COMPTANT|PAIEMENT CB|ACHAT CB|CB CARREFOUR|RETRAIT)\b/i;

      const matches = statement.transactions.filter((t) => matcher(t.description) && !NOT_A_CREDIT.test(t.description));
      for (const t of matches) {
        await this.loans.addOccurrence(loan.id, {
          statementId: statement.id,
          date: t.date,
          amount: t.amount,
          transactionId: t.id,
          description: t.description,
        });
      }
    }
  }

  // Whitelist stricte des organismes de crédit français reconnus
  // (membres ASF + acteurs BNPL + filiales banques spécialisées en crédit conso).
  // Si Claude met `creditor` à autre chose (BPCE Assurances, Predica, EDF…),
  // on n'auto-crée PAS de Loan : la suggestion reste pending pour tri manuel.
  // Source : REGAFI ACPR + Association française des Sociétés Financières.
  private readonly KNOWN_LOAN_CREDITORS = new Set([
    // Filiales bancaires spécialisées crédit conso
    'cetelem',                            // BNP Paribas Personal Finance
    'cofinoga',                           // BNP
    'sofinco',                            // CA Consumer Finance
    'ca consumer finance',
    'creditas',
    'crédit agricole consumer finance',
    'franfinance',                        // Société Générale
    'societe generale insurance financial services',
    'floa',                               // BPCE
    'bpce financement',
    'banque postale consumer finance',
    'lbp consumer finance',
    'monabanq',                           // Crédit Mutuel
    // Indépendants / spécialistes
    'cofidis',
    'carrefour banque',
    'banque casino',
    'oney',                               // Auchan / BPCE
    'younited',
    'younited credit',
    // BNPL (Buy Now Pay Later)
    'klarna',
    'alma',
    'pledg',
    'paypal credit',
    // Constructeurs auto / financements spécifiques
    'cofica bail',
    'diac',                               // Renault Finance
    'rci banque',                         // Renault
    'psa bank',                           // Stellantis
    'volkswagen financial services',
    'bnp paribas personal finance',
  ]);

  /**
   * Patterns de "paiement échelonné" (4X CB / pay-in-N / FacilyPay / PayPal Pay
   * Later) — qui sont des paiements 2-4 fois SANS frais, pas des crédits.
   * Ils transitent souvent par des organismes whitelisted (Cofidis, Alma,
   * Klarna, Floa…), créant des faux positifs si on auto-crée un Loan.
   *
   * Si le label/matchPattern d'une suggestion contient l'un de ces marqueurs,
   * on l'exclut de l'auto-création et on snooze pour tri manuel.
   */
  private static readonly PAY_IN_N_PATTERN =
    /\b([2-9]\s?(X|FOIS)|N\s?FOIS|N FOIS|EN \d+ FOIS|PAY ?LATER|PAY ?PLUS ?TARD|FACILYPAY|3X|4X|3 FOIS|4 FOIS)\b/i;

  /**
   * Seuil minimum d'occurrences pour auto-créer un Loan depuis une suggestion.
   * Un paiement en 4 fois a 4 occurrences MAX. Un vrai crédit conso ou auto
   * dépasse normalement les 6 mois. Au-dessous de ce seuil, snooze pour tri
   * manuel — l'user peut accepter via UI s'il sait que c'est un vrai crédit.
   */
  private static readonly MIN_OCCURRENCES_AUTO_CREATE = 5;

  private async autoCreateLoansFromSuggestions(): Promise<void> {
    const suggestions = await this.suggestions.getPending();

    // Group loan-type suggestions by (creditor + monthlyAmount rounded).
    // A single creditor can have multiple credits (e.g., Carrefour Banque a une
    // réserve + une carte Pass), each with a distinct monthly payment.
    // Grouping by montant arrondi évite de fusionner ces sous-crédits.
    type SuggWithCreditor = (typeof suggestions)[number] & { creditor: string };
    const byKey = new Map<string, SuggWithCreditor[]>();
    for (const s of suggestions) {
      if (s.suggestedType !== 'loan' || !s.creditor) continue;
      const creditorKey = s.creditor.toLowerCase().trim();
      if (!this.KNOWN_LOAN_CREDITORS.has(creditorKey)) continue;
      // Filter pay-in-N (paiements échelonnés 4X/3X/FacilyPay/PayLater)
      if (
        AutoSyncService.PAY_IN_N_PATTERN.test(s.label) ||
        AutoSyncService.PAY_IN_N_PATTERN.test(s.matchPattern)
      ) {
        this.logger.log(
          `Skipping pay-in-N pattern: "${s.label}" (creditor=${s.creditor}) — pas un vrai crédit`,
        );
        // Snooze pour ne pas re-proposer en boucle, mais laisser l'user trier
        try { await this.suggestions.snooze(s.id); } catch { /* noop */ }
        continue;
      }
      // Round to nearest euro for the bucket key (accommodates 99.37 vs 99.50 etc.)
      const amountKey = Math.round(s.monthlyAmount).toString();
      const groupKey = `${creditorKey}|${amountKey}`;
      if (!byKey.has(groupKey)) byKey.set(groupKey, []);
      byKey.get(groupKey)!.push(s as SuggWithCreditor);
    }

    // For each (creditor, amount) bucket, auto-create one Loan UNLESS a similar
    // Loan already exists. "Similar" = same creditor field AND monthlyPayment
    // within ±5€ of the bucket amount, OR a manual loan whose name contains
    // the creditor string and matching monthlyPayment.
    const existingLoans = await this.loans.getAll();

    for (const [groupKey, sugs] of byKey.entries()) {
      const [creditorKey, amountStr] = groupKey.split('|');
      const bucketAmount = Number(amountStr);
      const matchedExisting = existingLoans.some((l) => {
        const sameAmount = Math.abs(l.monthlyPayment - bucketAmount) < 5;
        if (!sameAmount) return false;
        const c = (l.creditor ?? '').toLowerCase().trim();
        if (c && c === creditorKey) return true;
        if (l.name.toLowerCase().includes(creditorKey)) return true;
        return false;
      });
      if (matchedExisting) continue;
      // Seuil min d'occurrences : un pay-in-4 a 4 occurrences max.
      // On somme les `occurrencesSeen` du bucket (les suggestions du même
      // creditor+amount fusionnées sur plusieurs statements parses).
      const totalOccurrences = sugs.reduce((s, sg) => s + sg.occurrencesSeen, 0);
      if (totalOccurrences < AutoSyncService.MIN_OCCURRENCES_AUTO_CREATE) {
        this.logger.log(
          `Skipping auto-create for ${creditorKey} @${bucketAmount}€ : ${totalOccurrences} occurrences (< ${AutoSyncService.MIN_OCCURRENCES_AUTO_CREATE}). Snooze pour tri manuel.`,
        );
        for (const s of sugs) {
          try { await this.suggestions.snooze(s.id); } catch { /* noop */ }
        }
        continue;
      }
      const totalMonthly = sugs.reduce((sum, s) => sum + s.monthlyAmount, 0);
      const avgMonthly = Math.round((totalMonthly / sugs.length) * 100) / 100;
      const creditor = sugs[0].creditor;
      // Name disambiguation: if more than one bucket exists for this creditor,
      // suffix with the amount so the user sees them as distinct.
      const sameCreditorBuckets = [...byKey.keys()].filter((k) => k.startsWith(creditorKey + '|'));
      const name = sameCreditorBuckets.length > 1
        ? `${creditor} (${avgMonthly.toFixed(2)} €/mois)`
        : creditor;
      const escaped = creditor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matchPattern = escaped.split(/\s+/).join('.*');
      await this.loans.create({
        name,
        type: 'classic',
        category: 'consumer',
        monthlyPayment: avgMonthly,
        matchPattern,
        isActive: true,
        creditor,
      });
      this.logger.log(`Auto-created Loan ${name} (avg ${avgMonthly}€/mois)`);
      for (const s of sugs) {
        try {
          await this.suggestions.snooze(s.id);
        } catch (err: unknown) {
          this.logger.warn(`Failed to snooze suggestion ${s.id}: ${(err as Error)?.message ?? err}`);
        }
      }
    }
  }

  private async autoDeactivateStaleLoans(): Promise<void> {
    const loans = await this.loans.getAll();
    const allStatements = await this.storage.getAllStatements();
    // Build sorted list of statement months (YYYY-MM)
    const sortedMonths = allStatements
      .map((s) => `${s.year}-${String(s.month).padStart(2, '0')}`)
      .sort();
    if (sortedMonths.length < 2) return; // not enough history yet
    // A loan is considered stale if NOT seen in the 2 most recent statement
    // months (we tolerate one month gap since a monthly debit can occasionally
    // skip — e.g., creditor changes payment date).
    const recentMonths = new Set(sortedMonths.slice(-2));

    // Skip loans created in the last 60 seconds — they were just auto-created
    // and haven't had a chance to accumulate occurrences yet (sync runs the
    // create+detect+deactivate trio in one pass).
    const freshThresholdMs = Date.now() - 60_000;

    for (const loan of loans) {
      if (!loan.isActive) continue;
      if (new Date(loan.createdAt).getTime() > freshThresholdMs) continue;
      const seenInRecent = loan.occurrencesDetected.some((o) => {
        const m = o.date.slice(0, 7);
        return recentMonths.has(m);
      });
      if (!seenInRecent) {
        const { id: _id, occurrencesDetected: _occ, createdAt: _ca, updatedAt: _ua, ...loanInput } = loan;
        void _id; void _occ; void _ca; void _ua;
        await this.loans.update(loan.id, {
          ...loanInput,
          isActive: false,
        });
        this.logger.log(`Auto-deactivated loan ${loan.name} (no occurrence in last 3 months)`);
      }
    }
  }
}
