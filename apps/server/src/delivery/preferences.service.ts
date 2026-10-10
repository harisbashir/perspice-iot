import { Inject, Injectable } from '@nestjs/common';
import { type NotificationPreferences, NotificationPreferencesSchema, TimezoneSchema } from '@perspice/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { DB } from '../db/db.module';
import { customer, notificationPreference, user } from '../db/schema';

export const PreferencesBody = z.object({
  /** Null = follow the customer's timezone (or UTC). */
  timezone: TimezoneSchema.nullable().optional(),
  preferences: NotificationPreferencesSchema,
});

export interface PreferencesView {
  timezone: string | null;
  /** The zone actually used (own, customer's, or UTC). */
  effectiveTimezone: string;
  preferences: NotificationPreferences;
}

@Injectable()
export class PreferencesService {
  constructor(@Inject(DB) private readonly db: DB) {}

  async get(userId: string): Promise<NotificationPreferences> {
    const row = await this.db.query.notificationPreference.findFirst({ where: eq(notificationPreference.userId, userId) });
    return NotificationPreferencesSchema.parse(row?.prefs ?? {});
  }

  async view(userId: string): Promise<PreferencesView> {
    const [row] = await this.db
      .select({ tz: user.timezone, customerTz: customer.timezone })
      .from(user)
      .leftJoin(customer, eq(customer.id, user.customerId))
      .where(eq(user.id, userId));
    return { timezone: row?.tz ?? null, effectiveTimezone: row?.tz ?? row?.customerTz ?? 'UTC', preferences: await this.get(userId) };
  }

  async update(userId: string, body: unknown): Promise<PreferencesView> {
    const { timezone, preferences } = PreferencesBody.parse(body);
    await this.db
      .insert(notificationPreference)
      .values({ userId, prefs: preferences })
      .onConflictDoUpdate({ target: notificationPreference.userId, set: { prefs: preferences, updatedAt: new Date() } });
    if (timezone !== undefined) await this.db.update(user).set({ timezone }).where(eq(user.id, userId));
    return this.view(userId);
  }
}
