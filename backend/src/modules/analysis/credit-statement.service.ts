import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { ClaudeUsageService } from '../claude-usage/claude-usage.service';
import { parseExternal } from '../../common/zod-validation.pipe';
import { isAuthError, isQuotaError } from '../../common/claude-errors';
import { CreditStatementOutputSchema } from './credit-statement.schemas';
import type { CreditStatementOutput } from './credit-statement.schemas';

export class CreditStatementParseError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'CreditStatementParseError';
  }
}

export interface CreditStatementAnalysis {
  creditor: string;
  creditType: 'revolving' | 'classic';
  currentBalance: number;
  maxAmount?: number;
  monthlyPayment: number;
  endDate: string | null;
  taeg: number | null;
  statementDate: string;
  startDate: string | null;
  accountNumber: string | null;
  rumNumber: string | null;
  installmentDetails: import('./credit-statement.schemas').InstallmentDetails | null;
}

const EXTRACT_CREDIT_STATEMENT_TOOL: Anthropic.Tool = {
  name: 'extract_credit_statement',
  description:
    "Extrait les informations clés d'un relevé de crédit (revolving ou classique).",
  input_schema: {
    type: 'object' as const,
    properties: {
      creditor: {
        type: 'string',
        description:
          "Nom de l'organisme prêteur en MAJUSCULES (ex: 'COFIDIS', 'SOFINCO', 'CETELEM', 'CARREFOUR BANQUE', 'FLOA', 'YOUNITED', 'FRANFINANCE', 'ONEY').",
      },
      creditType: {
        type: 'string',
        enum: ['revolving', 'classic'],
        description:
          "'revolving' = crédit renouvelable / réserve d'argent / Compte permanent ; 'classic' = prêt amortissable à mensualité fixe (auto, conso, immo, étudiant).",
      },
      currentBalance: {
        type: 'number',
        description:
          "Pour un classic : capital restant dû (positif). Pour un revolving : montant utilisé / dette en cours (positif).",
      },
      maxAmount: {
        type: 'number',
        description:
          "Plafond accordé. Requis pour un revolving. Optionnel pour un classic (généralement non affiché sur les relevés mensuels).",
      },
      monthlyPayment: {
        type: 'number',
        description: 'Mensualité courante (positive, en euros).',
      },
      endDate: {
        type: ['string', 'null'],
        description:
          "Date de fin de remboursement au format YYYY-MM-DD si elle figure sur le relevé. null pour un revolving (pas de fin) ou si l'info n'est pas disponible.",
      },
      taeg: {
        type: ['number', 'null'],
        description:
          'TAEG (taux annuel effectif global) en pourcentage si affiché (ex: 19.84 pour 19,84 %). null sinon.',
      },
      statementDate: {
        type: 'string',
        description: "Date d'arrêté du relevé (mois courant) au format YYYY-MM-DD. C'est la date d'émission du document, PAS la date de début du crédit.",
      },
      startDate: {
        type: ['string', 'null'],
        description: "Date de début du crédit (date de la 1ère échéance ou de la souscription) au format YYYY-MM-DD si elle figure sur le relevé. À distinguer formellement de statementDate. null pour un revolving (pas de début significatif) ou si l'info n'est pas affichée.",
      },
      accountNumber: {
        type: ['string', 'null'],
        description:
          'Numéro de contrat / compte tel qu\'affiché sur le relevé. null si absent.',
      },
      rumNumber: {
        type: ['string', 'null'],
        description:
          "Référence Unique de Mandat SEPA (RUM) si elle figure sur le relevé. Format typique : suite alphanumérique (ex: 'COFI20240315ABC123', 'FRR0123456789'). Distinct du numéro de contrat. null si absent. Apparaît surtout sur les relevés Cofidis/Sofinco où le contractNumber peut manquer.",
      },
      installmentDetails: {
        type: ['object', 'null'],
        description:
          "Présent UNIQUEMENT si le PDF est un CONTRAT de paiement échelonné court (titre type 'Contrat de paiement en 4XCB' / '3X' / '4 FOIS' / 'FacilyPay' / 'Pay Later'). Le contrat liste explicitement les N échéances avec dates et montants. NE PAS confondre avec un relevé mensuel revolving classique (qui aussi liste des mensualités, mais comme historique, pas comme contrat futur). null si le PDF est un relevé mensuel ordinaire.",
        properties: {
          count: { type: 'number', description: "Nombre d'échéances (N pour NXCB)." },
          amount: { type: 'number', description: 'Montant uniforme par échéance (si variable, prendre la 1ère ou la moyenne).' },
          installments: {
            type: 'array',
            description: 'Liste des N échéances avec date exacte et montant. Calculer les dates depuis "X jours après envoi" + signatureDate, ou utiliser les dates absolues si affichées.',
            items: {
              type: 'object',
              properties: {
                date: { type: 'string', description: 'YYYY-MM-DD' },
                amount: { type: 'number' },
              },
              required: ['date', 'amount'],
            },
          },
          merchant: {
            type: ['string', 'null'],
            description: "Nom du commerçant chez qui l'achat a été fait (ex: 'AMAZON', 'BACKMARKET', 'FNAC'). Souvent affiché 'Chez : XXX' sur les contrats Cofidis.",
          },
          signatureDate: {
            type: ['string', 'null'],
            description: "Date de signature du contrat (YYYY-MM-DD). Souvent affiché 'Contrat accepté le ...'.",
          },
          totalAmount: { type: 'number', description: 'Montant total à rembourser.' },
          fees: {
            type: ['number', 'null'],
            description: 'Frais (si distincts du capital). null si pas de frais ou inclus.',
          },
        },
        required: ['count', 'amount', 'installments', 'totalAmount'],
      },
    },
    required: [
      'creditor',
      'creditType',
      'currentBalance',
      'monthlyPayment',
      'statementDate',
    ],
  },
};

@Injectable()
export class CreditStatementService {
  private readonly client: Anthropic;
  private readonly logger = new Logger(CreditStatementService.name);

  constructor(
    private config: ConfigService,
    private usage: ClaudeUsageService,
  ) {
    this.client = new Anthropic({
      apiKey: this.config.get<string>('anthropicApiKey'),
    });
  }

  async analyzeCreditStatement(pdfBuffer: Buffer): Promise<CreditStatementAnalysis> {
    const base64Pdf = pdfBuffer.toString('base64');
    this.logger.log(
      `Sending credit-statement PDF to Anthropic (${Math.round(pdfBuffer.length / 1024)} KB)`,
    );

    try {
      const stream = this.client.messages.stream({
        model: 'claude-sonnet-4-5',
        max_tokens: 8192,
        temperature: 0,
        system:
          "Tu es un spécialiste de l'extraction de données de crédits français (Cofidis, Sofinco, Cetelem, Carrefour Banque, Floa, Younited, Franfinance, Oney…). Lis le relevé de crédit fourni en PDF et appelle l'outil `extract_credit_statement` avec les valeurs trouvées.\n\nRÈGLES :\n- creditType = 'revolving' si le PDF mentionne crédit renouvelable, réserve d'argent, compte permanent, plafond/limite autorisée, ou si le solde varie librement. Sinon 'classic' (mensualité fixe, capital restant dû qui décroît, échéancier).\n- currentBalance : pour classic = capital restant dû (POSITIF) ; pour revolving = montant utilisé / utilisation actuelle (POSITIF).\n- maxAmount : plafond autorisé (revolving uniquement, sauf si explicitement affiché sur un classic).\n- monthlyPayment : mensualité courante en euros (positive).\n- endDate : YYYY-MM-DD si affichée. null pour revolving.\n- taeg : pourcentage avec décimales (19,84 → 19.84).\n- statementDate : date d'arrêté du relevé, YYYY-MM-DD. Convertis '15 mars 2026' → '2026-03-15' et '15/03/2026' → '2026-03-15' (format français DD/MM/YYYY).\n- creditor : nom court en MAJUSCULES.\n- accountNumber : numéro de contrat tel qu'affiché. null s'il n'apparaît pas explicitement.\n- rumNumber : Référence Unique de Mandat SEPA si elle figure (souvent sur les relevés Cofidis/Sofinco quand le contractNumber est absent). null si pas de mandat SEPA mentionné.\n- statementDate : date d'arrêté du relevé courant (le mois pour lequel le relevé est émis).\n- startDate : date de début du crédit / 1ère échéance, distincte de statementDate. null si revolving ou non-affichée.\n\n**INSTALLMENTDETAILS — règle critique** : si le titre/type du PDF est 'Contrat de paiement en NXCB', '4XCB', '3X', '4 FOIS', 'FacilyPay', 'Pay Later', 'Pay in N', c'est un CONTRAT de paiement échelonné court. Remplir installmentDetails avec les N échéances précises. Dans ce cas, mettre AUSSI creditType='classic', currentBalance=totalAmount, monthlyPayment=installments[0].amount.\n\nSinon (relevé mensuel ordinaire d'un crédit revolving ou amortissable) → installmentDetails: null.\n\nDates des installments : si le PDF dit 'Prélevée X jours après l'envoi de la commande' et donne 'Contrat accepté le YYYY-MM-DD' (signatureDate), calculer chaque date = signatureDate + X jours. Format YYYY-MM-DD.",
        tools: [EXTRACT_CREDIT_STATEMENT_TOOL],
        tool_choice: { type: 'tool', name: 'extract_credit_statement' },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: base64Pdf,
                },
              },
              {
                type: 'text',
                text: "Extrais les données de ce relevé de crédit. Sois précis sur creditType (revolving vs classic) et currentBalance (capital restant dû OU utilisation revolving).",
              },
            ],
          },
        ],
      });
      const message = await stream.finalMessage();

      this.usage.recordUsage(message.usage.input_tokens, message.usage.output_tokens);
      this.logger.log(`credit-statement: stop_reason=${message.stop_reason}`);

      if (message.stop_reason === 'max_tokens') {
        throw new CreditStatementParseError(
          'Réponse Claude tronquée (max_tokens atteint) — relevé trop volumineux',
        );
      }

      const block = message.content.find((b) => b.type === 'tool_use');
      if (!block || block.type !== 'tool_use') {
        throw new CreditStatementParseError('Aucun tool_use renvoyé par Claude');
      }

      let parsed: CreditStatementOutput;
      try {
        parsed = parseExternal(
          CreditStatementOutputSchema,
          block.input,
          'Claude credit-statement',
        );
      } catch (err) {
        throw new CreditStatementParseError((err as Error).message, err);
      }

      return {
        creditor: parsed.creditor,
        creditType: parsed.creditType,
        currentBalance: parsed.currentBalance,
        maxAmount: parsed.maxAmount,
        monthlyPayment: parsed.monthlyPayment,
        endDate: parsed.endDate ?? null,
        taeg: parsed.taeg ?? null,
        statementDate: parsed.statementDate,
        startDate: parsed.startDate ?? null,
        accountNumber: parsed.accountNumber ?? null,
        rumNumber: parsed.rumNumber ?? null,
        installmentDetails: parsed.installmentDetails ?? null,
      };
    } catch (err) {
      if (isAuthError(err)) {
        throw new HttpException(
          {
            code: 'CLAUDE_AUTH_ERROR',
            message: 'Clé API Claude invalide/révoquée — vérifie ANTHROPIC_API_KEY',
          },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      if (isQuotaError(err)) {
        throw new HttpException('CLAUDE_QUOTA_EXCEEDED', HttpStatus.PAYMENT_REQUIRED);
      }
      throw err;
    }
  }
}
