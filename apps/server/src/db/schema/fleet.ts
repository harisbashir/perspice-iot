import { bigint, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './_common';
import { deviceProfile } from './devices';
import { user } from './users';

/** A firmware image for a profile's devices; the file is at `file_key` in storage. */
export const firmware = pgTable(
  'firmware',
  {
    id: id(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => deviceProfile.id, { onDelete: 'cascade' }),
    version: text('version').notNull(),
    fileKey: text('file_key').notNull(),
    sha256: text('sha256').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    notes: text('notes').notNull().default(''),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [uniqueIndex('firmware_profile_version_idx').on(t.profileId, t.version), index('firmware_profile_idx').on(t.profileId)],
);
