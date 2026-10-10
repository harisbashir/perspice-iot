import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { generateDeviceDefinition, overviewDefinition, withAlarmWidgets, withMapWidget } from '../dashboards/defaults';
import { EMAIL_SUBJECTS, EMAIL_TEMPLATE_KEYS } from '../email/templates';
import { seedRoles } from '../rbac/seed-roles';
import type { DB } from './db.module';
import { dashboardTemplate, deviceProfile, emailTemplate } from './schema';

type NewProfile = typeof deviceProfile.$inferInsert;

export const DEFAULT_PROFILES: NewProfile[] = [
  {
    name: 'Generic Sensor',
    description: 'Temperature and humidity sensor.',
    telemetrySchema: [
      { key: 'temperature', label: 'Temperature', unit: '°C', type: 'number', decimals: 1 },
      { key: 'humidity', label: 'Humidity', unit: '%', type: 'number', decimals: 0 },
    ],
    commands: [],
    offlineTimeoutS: 300,
    deadTimeoutS: 86400,
  },
  {
    name: 'Telecom RMS',
    description: 'Remote monitoring for telecom sites: mains, generator, fuel, battery and door.',
    telemetrySchema: [
      { key: 'mains_v', label: 'Mains voltage', unit: 'V', type: 'number', decimals: 0 },
      { key: 'gen_running', label: 'Generator running', type: 'boolean' },
      { key: 'fuel_level', label: 'Fuel level', unit: '%', type: 'number', decimals: 1 },
      { key: 'batt_v', label: 'Battery voltage', unit: 'V', type: 'number', decimals: 2 },
      { key: 'door_open', label: 'Door open', type: 'boolean' },
    ],
    commands: [
      { name: 'gen_start', label: 'Start generator', confirm: true },
      { name: 'gen_stop', label: 'Stop generator', confirm: true },
    ],
    offlineTimeoutS: 300,
    deadTimeoutS: 86400,
    statusNotify: { enabled: true, roleKeys: ['customer_admin', 'platform_admin'], channels: ['email', 'inapp'] },
  },
];

/** Idempotent: built-in roles, default profiles (by name) and editable copies of email templates. */
export async function seed(db: DB): Promise<void> {
  await seedRoles(db);

  for (const p of DEFAULT_PROFILES) {
    let profile = await db.query.deviceProfile.findFirst({ where: eq(deviceProfile.name, p.name) });
    if (!profile) [profile] = await db.insert(deviceProfile).values(p).returning();
    // Seeded profiles come with a generated dashboard (kept if an admin already chose one).
    if (profile && !profile.defaultDashboardTemplateId) {
      const [tpl] = await db
        .insert(dashboardTemplate)
        .values({ name: `${profile.name} dashboard`, kind: 'device', profileId: profile.id, definition: generateDeviceDefinition(profile) })
        .returning();
      await db.update(deviceProfile).set({ defaultDashboardTemplateId: tpl!.id }).where(eq(deviceProfile.id, profile.id));
    }
  }

  const overview = await db.query.dashboardTemplate.findFirst({
    where: and(eq(dashboardTemplate.kind, 'overview'), eq(dashboardTemplate.builtIn, true), isNull(dashboardTemplate.profileId)),
  });
  if (!overview) {
    await db.insert(dashboardTemplate).values({ name: 'Overview', kind: 'overview', builtIn: true, definition: overviewDefinition() });
  } else {
    // v0.3.0 adds alarm widgets, v0.5.0 a map; customised copies then see "template changed" and can re-sync.
    const withAlarms = withAlarmWidgets(overview.definition) ?? overview.definition;
    const withMap = withMapWidget(withAlarms);
    const upgraded = withMap ?? (withAlarms !== overview.definition ? withAlarms : null);
    if (upgraded) {
      await db
        .update(dashboardTemplate)
        .set({ definition: upgraded, version: overview.version + 1, updatedAt: new Date() })
        .where(eq(dashboardTemplate.id, overview.id));
    }
  }

  const dir = join(__dirname, '../email/templates');
  await db
    .insert(emailTemplate)
    .values(
      EMAIL_TEMPLATE_KEYS.map((key) => ({
        key,
        customerId: null,
        subject: EMAIL_SUBJECTS[key],
        bodyMjml: readFileSync(join(dir, `${key}.mjml`), 'utf8'),
      })),
    )
    .onConflictDoNothing();
}
