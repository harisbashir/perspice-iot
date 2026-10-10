import { and, eq, isNull, isNotNull, sql } from 'drizzle-orm';
import type { DB } from '../db/db.module';
import { dashboardInstance, device, deviceProfile } from '../db/schema';

/** Idempotently returns the instance of `templateId` for `customerId` (null = platform). */
export async function ensureInstance(db: DB, templateId: string, customerId: string | null) {
  await db.insert(dashboardInstance).values({ templateId, customerId }).onConflictDoNothing();
  const [row] = await db
    .select()
    .from(dashboardInstance)
    .where(
      and(
        eq(dashboardInstance.templateId, templateId),
        customerId ? eq(dashboardInstance.customerId, customerId) : isNull(dashboardInstance.customerId),
      ),
    );
  return row!;
}

/** Called when a device is assigned: its customer gets an instance of the profile's default template. */
export async function ensureDeviceDashboard(db: DB, profileId: string, customerId: string | null): Promise<void> {
  if (!customerId) return;
  const profile = await db.query.deviceProfile.findFirst({
    where: eq(deviceProfile.id, profileId),
    columns: { defaultDashboardTemplateId: true },
  });
  if (profile?.defaultDashboardTemplateId) await ensureInstance(db, profile.defaultDashboardTemplateId, customerId);
}

/** When a profile gets a default template, every customer that already has such devices gets an instance. */
export async function backfillInstances(db: DB, profileId: string, templateId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO ${dashboardInstance} (template_id, customer_id)
    SELECT DISTINCT ${templateId}::uuid, ${device.customerId}
    FROM ${device}
    WHERE ${and(eq(device.profileId, profileId), isNotNull(device.customerId))}
    ON CONFLICT DO NOTHING`);
}
