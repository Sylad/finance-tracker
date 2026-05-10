import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { ClaudeUsageService } from '../claude-usage/claude-usage.service';
import { parseExternal } from '../../common/zod-validation.pipe';
import { isAuthError, isQuotaError } from '../../common/claude-errors';
import { AmortizationOutputSchema } from './amortization.schemas';
import type { AmortizationOutput } from './amortization.schemas';

export class AmortizationParseError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'AmortizationParseError';
  }
}

const EXTRACT_AMORTIZATION_TOOL: Anthropic.Tool = {
  name: 'extract_amortization_schedule',
  description:
    "Extrait les informations d'un tableau d'amortissement de crédit classique français (auto, conso, immo). Le tableau d'amortissement est statique : il liste l'échéancier prévu mois par mois (capital restant dû, capital amorti, intérêts payés).",
  input_schema: {
    type: 'object' as const,
    properties: {
      creditor: {
        type: 'string',
        description:
          "Nom de l'organisme prêteur en MAJUSCULES (ex: 'CETELEM', 'COFIDIS', 'BNP PARIBAS', 'CRÉDIT AGRICOLE', 'BANQUE POSTALE').",
      },
      initialPrincipal: {
        type: 'number',
        description:
          "Capital initial emprunté (montant total du crédit). Toujours positif, en euros.",
      },
      monthlyPayment: {
        type: 'number',
        description: 'Mensualité fixe (positive, en euros). Si le tableau présente des mensualités variables, prendre la valeur courante ou la moyenne.',
      },
      startDate: {
        type: 'string',
        description: "Date de début du crédit (1ère échéance) au format YYYY-MM-DD.",
      },
      endDate: {
        type: 'string',
        description: "Date de fin du crédit (dernière échéance) au format YYYY-MM-DD.",
      },
      taeg: {
        type: ['number', 'null'],
        description:
          'TAEG (taux annuel effectif global) en pourcentage si affiché (ex: 4.85 pour 4,85 %). null si absent.',
      },
      schedule: {
        type: 'array',
        description:
          "Échéancier complet : une entrée par échéance (mensuelle typiquement, mais peut être trimestrielle ou annuelle pour certains crédits). Lister TOUTES les lignes du tableau, dans l'ordre chronologique. Pour les crédits longs (immo 240-360 mois), donner toutes les lignes même si répétitif.",
        items: {
          type: 'object',
          properties: {
            date: {
              type: 'string',
              description: "Date de l'échéance au format YYYY-MM-DD.",
            },
            capitalRemaining: {
              type: 'number',
              description: 'Capital restant dû en fin de période (≥ 0).',
            },
            capitalPaid: {
              type: 'number',
              description: 'Part de capital amortie sur cette échéance (≥ 0).',
            },
            interestPaid: {
              type: 'number',
              description: "Part d'intérêts payée sur cette échéance (≥ 0).",
            },
          },
          required: ['date', 'capitalRemaining', 'capitalPaid', 'interestPaid'],
        },
      },
    },
    required: [
      'creditor',
      'initialPrincipal',
      'monthlyPayment',
      'startDate',
      'endDate',
      'schedule',
    ],
  },
};

@Injectable()
export class AmortizationService {
  private readonly client: Anthropic;
  private readonly logger = new Logger(AmortizationService.name);

  constructor(
    private config: ConfigService,
    private usage: ClaudeUsageService,
  ) {
    this.client = new Anthropic({
      apiKey: this.config.get<string>('anthropicApiKey'),
    });
  }

  async analyzeAmortization(pdfBuffer: Buffer): Promise<AmortizationOutput> {
    const base64Pdf = pdfBuffer.toString('base64');
    this.logger.log(
      `Sending amortization PDF to Anthropic (${Math.round(pdfBuffer.length / 1024)} KB)`,
    );

    try {
      const stream = this.client.messages.stream({
        model: 'claude-sonnet-4-5',
        max_tokens: 16384,
        temperature: 0,
        system:
          "Tu es un spécialiste de l'extraction de tableaux d'amortissement de crédits français (auto, conso, immo). Lis le PDF fourni et appelle l'outil `extract_amortization_schedule` avec les valeurs trouvées.\n\nRÈGLES :\n- creditor : nom court de l'organisme en MAJUSCULES.\n- initialPrincipal : capital total emprunté (positif, euros).\n- monthlyPayment : mensualité fixe en euros (positive). Pour mensualités variables, prendre la valeur dominante.\n- startDate / endDate : 1ère et dernière échéance au format YYYY-MM-DD. Convertis depuis '15/03/2026' (DD/MM/YYYY français) ou '15 mars 2026' → '2026-03-15'.\n- taeg : pourcentage avec décimales (4,85 → 4.85). null si pas affiché.\n- schedule : LISTER TOUTES LES LIGNES du tableau dans l'ordre chronologique. Chaque ligne = { date, capitalRemaining (capital restant dû en FIN de période), capitalPaid (part capital de l'échéance), interestPaid (part intérêts) }. Le capitalRemaining de la dernière ligne doit être ≈ 0.",
        tools: [EXTRACT_AMORTIZATION_TOOL],
        tool_choice: { type: 'tool', name: 'extract_amortization_schedule' },
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
                text: "Extrais le tableau d'amortissement complet de ce PDF. N'omets aucune ligne. Si la somme des capitalPaid ≠ initialPrincipal à la fin, double-vérifie ton extraction.",
              },
            ],
          },
        ],
      });
      const message = await stream.finalMessage();

      this.usage.recordUsage(message.usage.input_tokens, message.usage.output_tokens);
      this.logger.log(`amortization: stop_reason=${message.stop_reason}`);

      if (message.stop_reason === 'max_tokens') {
        throw new AmortizationParseError(
          'Réponse Claude tronquée (max_tokens atteint) — tableau trop volumineux',
        );
      }

      const block = message.content.find((b) => b.type === 'tool_use');
      if (!block || block.type !== 'tool_use') {
        throw new AmortizationParseError('Aucun tool_use renvoyé par Claude');
      }

      let parsed: AmortizationOutput;
      try {
        parsed = parseExternal(
          AmortizationOutputSchema,
          block.input,
          'Claude amortization',
        );
      } catch (err) {
        throw new AmortizationParseError((err as Error).message, err);
      }

      // Tri chronologique défensif (Claude renvoie normalement dans l'ordre,
      // mais on ne fait pas confiance aveuglément).
      parsed.schedule.sort((a, b) => a.date.localeCompare(b.date));

      this.logger.log(
        `amortization extracted: ${parsed.creditor}, ${parsed.schedule.length} lignes, capital ${parsed.initialPrincipal}€`,
      );

      return parsed;
    } catch (err) {
      if (err instanceof AmortizationParseError) throw err;
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
