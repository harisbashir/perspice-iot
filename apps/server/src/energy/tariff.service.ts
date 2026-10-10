import { Inject, Injectable } from '@nestjs/common';
import { type TariffDto, TariffSchema } from '@perspice/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { notFound } from '../common/app-error';
import { CustomersService } from '../customers/customers.service';
import { DB } from '../db/db.module';
import { tariff } from '../db/schema';

const PLATFORM = 'platform';
const PutTariff = TariffSchema.extend({ customerId: z.string().uuid().nullish() });

/**
 * Energy tariffs (spec §11): a platform default and one per customer. Customers read and manage
 * only their own (falling back to the default); platform users name the customer, or none for
 * the default.
 */
@Injectable()
export class TariffService {
  constructor(
    @Inject(DB) private readonly db: DB,
    private readonly customers: CustomersService,
  ) {}

  /** The tariff that prices a customer's (or an unassigned device's) energy. */
  async effective(customerId: string | null): Promise<TariffDto | null> {
    if (customerId) {
      const own = await this.db.query.tariff.findFirst({ where: eq(tariff.scope, customerId) });
      if (own) return toDto(own, false);
    }
    const fallback = await this.db.query.tariff.findFirst({ where: eq(tariff.scope, PLATFORM) });
    return fallback ? toDto(fallback, !!customerId) : null;
  }

  async get(actor: AuthUser, customerId?: string): Promise<TariffDto | null> {
    return this.effective(await this.target(actor, customerId));
  }

  async put(actor: AuthUser, body: unknown): Promise<TariffDto> {
    const { customerId, ...input } = PutTariff.parse(body);
    const target = await this.target(actor, customerId ?? undefined);
    const values = { ...input, scope: target ?? PLATFORM, customerId: target, updatedAt: new Date() };
    const [row] = await this.db.insert(tariff).values(values).onConflictDoUpdate({ target: tariff.scope, set: values }).returning();
    return toDto(row!, false);
  }

  /** A customer's tariff removed: the platform default applies again. */
  async remove(actor: AuthUser, customerId?: string): Promise<void> {
    const target = await this.target(actor, customerId);
    await this.db.delete(tariff).where(eq(tariff.scope, target ?? PLATFORM));
  }

  /** The customer acted on: a customer user's own, whatever they name; null = platform default. */
  private async target(actor: AuthUser, customerId: string | undefined): Promise<string | null> {
    if (actor.scopeType === 'customer') return actor.customerId!;
    if (!customerId) return null;
    const c = await this.customers.get(customerId).catch(() => null);
    if (!c) throw notFound();
    return c.id;
  }
}

function toDto(row: typeof tariff.$inferSelect, inherited: boolean): TariffDto {
  return { currency: row.currency, defaultRate: row.defaultRate, periods: row.periods, customerId: row.customerId, inherited };
}
