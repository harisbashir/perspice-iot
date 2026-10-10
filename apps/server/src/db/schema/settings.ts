import { boolean, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const systemSetting = pgTable('system_setting', {
  key: text('key').primaryKey(),
  /** Secret values are stored as an encrypted string (see SettingsService). */
  value: jsonb('value').notNull(),
  secret: boolean('secret').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
