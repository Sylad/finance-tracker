import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { z } from 'zod';
import { SubscriptionsService } from './subscriptions.service';
import { validateSubscriptionInput } from './dto/subscription.dto';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';

const MergeSchema = z.object({
  canonicalId: z.string().min(1),
  duplicateIds: z.array(z.string().min(1)).min(1),
});

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly svc: SubscriptionsService) {}

  @Get()
  list() { return this.svc.getAll(); }

  @Get('duplicates')
  duplicates() { return this.svc.detectDuplicates(); }

  @Get(':id')
  one(@Param('id') id: string) { return this.svc.getOne(id); }

  @Post()
  async create(@Body() body: unknown) {
    const input = validateSubscriptionInput(body);
    // Invariant 1 retrait/mois max : avant de créer, vérifie qu'un sub
    // similaire n'existe pas déjà. Si match → renvoie l'existant (idempotent).
    const existing = await this.svc.findExisting({
      name: input.name,
      matchPattern: input.matchPattern,
      monthlyAmount: input.monthlyAmount,
    });
    if (existing) return existing;
    return this.svc.create(input);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.svc.update(id, validateSubscriptionInput(body));
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string): Promise<void> {
    await this.svc.delete(id);
  }

  @Post('merge-duplicates')
  mergeDuplicates(
    @Body(new ZodValidationPipe(MergeSchema))
    body: { canonicalId: string; duplicateIds: string[] },
  ) {
    return this.svc.mergeDuplicates(body.canonicalId, body.duplicateIds);
  }
}
