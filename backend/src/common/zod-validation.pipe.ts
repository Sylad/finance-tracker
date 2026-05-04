import { PipeTransform, BadRequestException, Logger } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * NestJS pipe that validates an incoming request value against a Zod schema.
 *
 * Use as `@Body(new ZodValidationPipe(MySchema)) body: z.infer<typeof MySchema>`.
 * Throws 400 on validation error with the field-level Zod issues attached.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  private readonly logger = new Logger(ZodValidationPipe.name);

  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      this.logger.warn(`Validation failed: ${result.error.message}`);
      throw new BadRequestException({
        message: 'Validation failed',
        errors: result.error.issues,
      });
    }
    return result.data;
  }
}

/**
 * Validates an external API response (not a user input) against a Zod schema.
 *
 * Use at the boundary where third-party JSON enters the system, so the rest
 * of the codebase can rely on a typed shape. Throws a generic Error instead
 * of an HTTP exception — callers decide whether to fall back, cache, or
 * re-throw as 502.
 */
export function parseExternal<T>(
  schema: ZodType<T>,
  value: unknown,
  source: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid ${source} response: ${result.error.message}`);
  }
  return result.data;
}
