import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { ClaudeUsageService } from '../claude-usage/claude-usage.service';

export class AnthropicParseError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'AnthropicParseError';
  }
}

export interface ClaudeAnalysisResult {
  bankName: string;
  accountHolder: string;
  statementMonth: number;
  statementYear: number;
  currency: string;
  openingBalance: number;
  closingBalance: number;
  transactions: ClaudeTransaction[];
  recurringCredits: ClaudeRecurringCredit[];
  scoreFactors: ClaudeScoreFactors;
  analysisNarrative: string;
  claudeHealthComment: string;
  suggestedRecurringExpenses?: {
    label: string;
    monthlyAmount: number;
    occurrencesSeen: number;
    firstSeenDate: string;
    suggestedType: 'loan' | 'subscription' | 'utility';
    matchPattern: string;
  }[];
  externalAccountBalances?: {
    accountNumber: string;
    accountType: string;
    balance: number;
    label?: string;
    asOfDate?: string;
  }[];
}

export interface ClaudeTransaction {
  date: string;
  description: string;
  normalizedDescription: string;
  amount: number;
  category: string;
  subcategory: string;
  isRecurring: boolean;
  recurringCreditEndDate: string | null;
  confidence: number;
  targetAccountNumber?: string | null;
}

export interface ClaudeRecurringCredit {
  description: string;
  normalizedDescription: string;
  monthlyAmount: number;
  frequency: string;
  firstSeenDate: string;
  lastSeenDate: string;
  contractEndDate: string | null;
  endDateConfidence: string;
  category: string;
}

export interface ClaudeScoreFactors {
  estimatedSavingsRate: number;
  discretionaryRatio: number;
  recurringObligationRatio: number;
  balanceTrend: number;
  spendingVarianceScore: number;
}

// Phase 1 tool: compact transaction extraction
const EXTRACT_TRANSACTIONS_TOOL: Anthropic.Tool = {
  name: 'extract_transactions',
  description: 'Extract all transactions and account info from the bank statement',
  input_schema: {
    type: 'object' as const,
    properties: {
      bankName: { type: 'string' },
      accountHolder: { type: 'string' },
      currency: { type: 'string', description: 'ISO 4217 e.g. EUR' },
      openingBalance: { type: 'number' },
      closingBalance: { type: 'number' },
      transactions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'YYYY-MM-DD' },
            label: { type: 'string', description: 'Cleaned readable label, max 60 chars' },
            amount: { type: 'number', description: 'Positive=credit, negative=debit' },
            category: {
              type: 'string',
              enum: ['income', 'housing', 'transport', 'food', 'health', 'entertainment', 'subscriptions', 'savings', 'transfers', 'taxes', 'other'],
            },
            isRecurring: { type: 'boolean' },
            targetAccountNumber: { type: 'string', description: "Pour les virements (libellé contenant 'VIREMENT POUR' ou similaire) : le numéro de compte destinataire complet si présent dans la description de l'opération. Sinon vide ou absent." },
          },
          required: ['date', 'label', 'amount', 'category', 'isRecurring'],
        },
      },
      externalAccountBalances: {
        type: 'array',
        description: "Soldes des autres comptes du même client affichés dans le PDF (section type 'Vos autres comptes' chez La Banque Postale). Chaque entrée contient le numéro de compte complet, le type (livret-a, pel, cel, ldds, pea, other), le solde et éventuellement le libellé et la date du solde. Renvoie un array vide si la section n'est pas présente.",
        items: {
          type: 'object',
          properties: {
            accountNumber: { type: 'string', description: 'Numéro de compte complet tel qu\'affiché dans le PDF' },
            accountType: { type: 'string', enum: ['livret-a', 'pel', 'cel', 'ldds', 'pea', 'other'] },
            balance: { type: 'number', description: 'Solde en euros (positif)' },
            label: { type: 'string', description: 'Libellé du compte si différent du type (ex: "Livret A SYLVAIN")' },
            asOfDate: { type: 'string', description: 'Date du solde au format YYYY-MM-DD si précisée' },
          },
          required: ['accountNumber', 'accountType', 'balance'],
        },
      },
    },
    required: ['bankName', 'accountHolder', 'currency', 'openingBalance', 'closingBalance', 'transactions'],
  },
};

// Phase 2 tool: financial analysis
const ANALYZE_TOOL: Anthropic.Tool = {
  name: 'analyze_finances',
  description: 'Analyse la santé financière à partir des données de transactions et propose des suggestions de charges récurrentes en français.',
  input_schema: {
    type: 'object' as const,
    properties: {
      recurringCredits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            normalizedDescription: { type: 'string' },
            monthlyAmount: { type: 'number' },
            frequency: { type: 'string', enum: ['monthly', 'bimonthly', 'quarterly', 'irregular'] },
            firstSeenDate: { type: 'string' },
            lastSeenDate: { type: 'string' },
            contractEndDate: { type: ['string', 'null'] },
            endDateConfidence: { type: 'string', enum: ['high', 'medium', 'low', 'none'] },
            category: { type: 'string', enum: ['salary', 'rental', 'pension', 'subsidy', 'investment', 'other'] },
          },
          required: ['description', 'normalizedDescription', 'monthlyAmount', 'frequency', 'firstSeenDate', 'lastSeenDate', 'endDateConfidence', 'category'],
        },
      },
      scoreFactors: {
        type: 'object',
        properties: {
          estimatedSavingsRate: { type: 'number', description: '0-1' },
          discretionaryRatio: { type: 'number', description: '0-1' },
          recurringObligationRatio: { type: 'number', description: '0-1' },
          balanceTrend: { type: 'number', description: '-1 to 1' },
          spendingVarianceScore: { type: 'number', description: '0-1, 1=very consistent' },
        },
        required: ['estimatedSavingsRate', 'discretionaryRatio', 'recurringObligationRatio', 'balanceTrend', 'spendingVarianceScore'],
      },
      analysisNarrative: { type: 'string', description: 'Résumé en français de 2-3 phrases (jamais en anglais)' },
      claudeHealthComment: { type: 'string', description: 'Forces et points d\'attention en français (jamais en anglais)' },
      suggestedRecurringExpenses: {
        type: 'array',
        description: "Charges récurrentes détectées (≥ 2 occurrences même libellé) qui pourraient être des crédits, abonnements ou factures (libellés en français).",
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            monthlyAmount: { type: 'number' },
            occurrencesSeen: { type: 'number' },
            firstSeenDate: { type: 'string', description: 'YYYY-MM-DD' },
            suggestedType: { type: 'string', enum: ['loan', 'subscription', 'utility'] },
            matchPattern: { type: 'string', description: 'Regex insensible à la casse pour matcher la transaction' },
          },
          required: ['label', 'monthlyAmount', 'occurrencesSeen', 'firstSeenDate', 'suggestedType', 'matchPattern'],
        },
      },
    },
    required: ['recurringCredits', 'scoreFactors', 'analysisNarrative', 'claudeHealthComment'],
  },
};

function isQuotaError(err: unknown): boolean {
  if (err instanceof Anthropic.RateLimitError) return true;
  if (err instanceof Anthropic.AuthenticationError) return true;
  if (err instanceof Anthropic.APIError) {
    const msg = (err.message ?? '').toLowerCase();
    return err.status === 402 || msg.includes('credit') || msg.includes('quota');
  }
  return false;
}

@Injectable()
export class AnthropicService {
  private readonly client: Anthropic;
  private readonly logger = new Logger(AnthropicService.name);

  constructor(
    private config: ConfigService,
    private usage: ClaudeUsageService,
  ) {
    this.client = new Anthropic({
      apiKey: this.config.get<string>('anthropicApiKey'),
    });
  }

  async analyzeBankStatement(pdfBuffer: Buffer): Promise<ClaudeAnalysisResult> {
    const base64Pdf = pdfBuffer.toString('base64');
    this.logger.log(`Sending PDF to Anthropic (${Math.round(pdfBuffer.length / 1024)} KB)`);

    try {
    // Phase 1: extract transactions from PDF
    // Phase 1 — extraction avec budget output adapté.
    // On part à 32k (4 × ancien défaut) ; si le relevé est volumineux et qu'on hit
    // max_tokens, on retente une fois avec 64k (max supporté par Sonnet 4.5).
    let phase1 = await this.runPhase1(base64Pdf, 32768);
    if (phase1.stop_reason === 'max_tokens') {
      this.logger.warn('Phase 1: max_tokens hit @ 32k, retrying @ 64k');
      phase1 = await this.runPhase1(base64Pdf, 64000);
    }

    this.usage.recordUsage(phase1.usage.input_tokens, phase1.usage.output_tokens);
    this.logger.log(`Phase 1: stop_reason=${phase1.stop_reason}`);
    if (phase1.stop_reason === 'max_tokens') {
      throw new AnthropicParseError(
        "Trop de transactions pour une seule analyse, même avec le budget maximum (64k tokens). " +
        "Si possible, scinde le PDF en deux périodes (1-15 et 16-fin du mois) et importe-les séparément.",
      );
    }

    const p1Block = phase1.content.find((b) => b.type === 'tool_use');
    if (!p1Block || p1Block.type !== 'tool_use') {
      throw new AnthropicParseError('Phase 1: no tool_use block returned');
    }
    const p1 = p1Block.input as Record<string, unknown>;
    const transactions = p1.transactions as Array<{ date: string; label: string; amount: number; category: string; isRecurring: boolean; targetAccountNumber?: string }>;
    this.logger.log(`Phase 1: extracted ${transactions.length} transactions`);

    // Derive period from transaction dates (mode of YYYY-MM, earliest wins ties).
    // We deliberately don't trust the AI for statementMonth/Year — bank PDFs are often
    // named/dated by issue date (J+9 of next month for LBP), and the AI was conflating
    // issue month with period month, causing two distinct PDFs to collide on the same id.
    const period = this.derivePeriodFromTransactions(transactions);
    if (!period) {
      throw new AnthropicParseError('Cannot determine statement period: no valid transaction dates extracted');
    }

    // Phase 2: analyze finances based on the extracted transaction summary
    const txSummary = transactions
      .map((t) => `${t.date} | ${t.category} | ${t.amount > 0 ? '+' : ''}${t.amount} | ${t.label}`)
      .join('\n');

    const phase2 = await this.client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      system: "Tu es un analyste financier. Analyse les transactions fournies et appelle l'outil analyze_finances. IMPORTANT : tous les champs textuels que tu produis (analysisNarrative, claudeHealthComment, libellés des suggestions) doivent être rédigés en français. N'utilise jamais l'anglais.",
      tools: [ANALYZE_TOOL],
      tool_choice: { type: 'tool', name: 'analyze_finances' },
      messages: [{
        role: 'user',
        content: `Banque : ${p1.bankName}\nPériode : ${period.month}/${period.year}\nDevise : ${p1.currency}\nSolde initial : ${p1.openingBalance}\nSolde final : ${p1.closingBalance}\n\nTransactions :\n${txSummary}\n\nIdentifie les crédits récurrents, calcule les facteurs de score, et rédige un bilan de santé financière en français.`,
      }],
    });

    this.usage.recordUsage(phase2.usage.input_tokens, phase2.usage.output_tokens);
    this.logger.log(`Phase 2: stop_reason=${phase2.stop_reason}`);

    const p2Block = phase2.content.find((b) => b.type === 'tool_use');
    if (!p2Block || p2Block.type !== 'tool_use') {
      throw new AnthropicParseError('Phase 2: no tool_use block returned');
    }
    const p2 = p2Block.input as Record<string, unknown>;

    // Merge results
    return this.mergeResults(p1, p2, transactions, period);
    } catch (err) {
      if (isQuotaError(err)) {
        throw new HttpException('CLAUDE_QUOTA_EXCEEDED', HttpStatus.PAYMENT_REQUIRED);
      }
      throw err;
    }
  }

  private mergeResults(
    p1: Record<string, unknown>,
    p2: Record<string, unknown>,
    rawTransactions: Array<{ date: string; label: string; amount: number; category: string; isRecurring: boolean; targetAccountNumber?: string }>,
    period: { year: number; month: number },
  ): ClaudeAnalysisResult {
    const transactions: ClaudeTransaction[] = rawTransactions.map((t) => ({
      date: t.date,
      description: t.label,
      normalizedDescription: t.label,
      amount: t.amount,
      category: t.category,
      subcategory: '',
      isRecurring: t.isRecurring ?? false,
      recurringCreditEndDate: null,
      confidence: 0.85,
      targetAccountNumber: t.targetAccountNumber ?? null,
    }));

    return {
      bankName: p1.bankName as string,
      accountHolder: p1.accountHolder as string,
      statementMonth: period.month,
      statementYear: period.year,
      currency: p1.currency as string,
      openingBalance: p1.openingBalance as number,
      closingBalance: p1.closingBalance as number,
      transactions,
      recurringCredits: (p2.recurringCredits as ClaudeRecurringCredit[]) ?? [],
      scoreFactors: p2.scoreFactors as ClaudeScoreFactors,
      analysisNarrative: p2.analysisNarrative as string,
      claudeHealthComment: p2.claudeHealthComment as string,
      suggestedRecurringExpenses: (p2.suggestedRecurringExpenses ?? []) as ClaudeAnalysisResult['suggestedRecurringExpenses'],
      externalAccountBalances: (p1.externalAccountBalances ?? []) as ClaudeAnalysisResult['externalAccountBalances'],
    };
  }

  private derivePeriodFromTransactions(
    txs: Array<{ date: string }>,
  ): { year: number; month: number } | null {
    // We classify by the month with the LARGEST temporal coverage
    // (number of distinct dates), not the largest tx count.
    //
    // Why: French bank statements (LBP, etc.) cover ~30 consecutive
    // days that straddle two calendar months — typically 10/MM →
    // 09/(MM+1). The previous month-of-record (~21 days) usually has
    // many more business days than the current month spillover (~9
    // days), but the spillover can have a high tx density (salary
    // arriving on day 1, recurring debits clustered) and would win
    // a raw count vote — leading to mis-classification.
    //
    // Counting unique days fixes this: 21 distinct days > 9 distinct
    // days no matter how many transactions happen on any single day.
    const daysByMonth = new Map<string, Set<string>>();
    for (const t of txs) {
      const m = t.date.match(/^(\d{4})-(0[1-9]|1[0-2])-(\d{2})/);
      if (!m) continue;
      const monthKey = `${m[1]}-${m[2]}`;
      const dayKey = m[3];
      if (!daysByMonth.has(monthKey)) daysByMonth.set(monthKey, new Set());
      daysByMonth.get(monthKey)!.add(dayKey);
    }
    if (!daysByMonth.size) return null;
    const [topKey] = [...daysByMonth.entries()].sort((a, b) => {
      if (b[1].size !== a[1].size) return b[1].size - a[1].size;
      return a[0].localeCompare(b[0]); // earlier YYYY-MM wins ties
    })[0];
    const [year, month] = topKey.split('-').map(Number);
    return { year, month };
  }

  private async runPhase1(base64Pdf: string, maxTokens: number) {
    // Use streaming API: required by the SDK when max_tokens is high enough
    // that the non-streaming timeout (10 min default) might be exceeded.
    // finalMessage() returns the same shape as messages.create() once done.
    const stream = this.client.messages.stream({
      model: 'claude-sonnet-4-5',
      max_tokens: maxTokens,
      system: "Tu es un spécialiste de l'extraction de données bancaires françaises. Extrais toutes les transactions du PDF de relevé bancaire en appelant l'outil extract_transactions. Sois exhaustif — inclus chaque transaction. Utilise des libellés courts (60 caractères max).\n\nFORMAT DES DATES — règle critique :\nLes dates dans les relevés bancaires français sont au format JOUR/MOIS/ANNÉE (DD/MM/YYYY ou DD/MM/YY). Tu dois ABSOLUMENT respecter cet ordre. NE JAMAIS interpréter à l'américaine (MM/DD).\n  - 10/02/2026 = 10 février 2026 → 2026-02-10 (PAS 2026-10-02 ni 2026-03-10)\n  - 09/03/26 = 9 mars 2026 → 2026-03-09\n  - 01/12/2025 = 1er décembre 2025 → 2025-12-01\nSi tu vois deux colonnes 'Date opération' et 'Date valeur', utilise toujours la 'Date opération' (la première).\nSi tu vois une date écrite en lettres ('15 janvier 2026'), convertis-la pareil (2026-01-15).\nEn cas de doute, vérifie que la date que tu produis est cohérente avec la période globale du relevé (un relevé édité le 9 mars couvre principalement février).\n\nSi le PDF contient une section 'Vos autres comptes' (ou équivalent listant les soldes d'autres comptes du client : Livret A, PEL, etc.), remplis externalAccountBalances.\n\nPour chaque virement (libellé débutant par 'VIREMENT POUR' ou similaire), si le libellé mentionne un numéro de compte destinataire, capture-le dans targetAccountNumber.",
      tools: [EXTRACT_TRANSACTIONS_TOOL],
      tool_choice: { type: 'tool', name: 'extract_transactions' },
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } },
          { type: 'text', text: "Extrais toutes les transactions de ce relevé bancaire. Inclus chaque débit et crédit. Utilise des libellés courts et nettoyés. Renseigne externalAccountBalances si une section 'Vos autres comptes' figure dans le PDF, et targetAccountNumber pour chaque virement contenant un n° de compte destinataire." },
        ],
      }],
    });
    return stream.finalMessage();
  }
}
