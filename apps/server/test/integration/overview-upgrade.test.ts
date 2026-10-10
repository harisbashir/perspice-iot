import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { overviewDefinition } from '../../src/dashboards/defaults';
import { seed } from '../../src/db/seed';
import { dashboardTemplate } from '../../src/db/schema';
import { type TestApp, createTestApp } from '../harness';

describe('overview upgrade', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  it('adds alarm widgets to a pre-0.3 overview once, bumping its version', async () => {
    const where = and(eq(dashboardTemplate.kind, 'overview'), eq(dashboardTemplate.builtIn, true));
    await seed(t.db);
    const current = (await t.db.query.dashboardTemplate.findFirst({ where }))!;
    const def = overviewDefinition();
    const old = { ...def, states: [{ ...def.states[0]!, widgets: def.states[0]!.widgets.filter((w) => !w.type.startsWith('alarm')), layout: def.states[0]!.layout.filter((l) => !l.i.startsWith('alarm')) }] };
    await t.db.update(dashboardTemplate).set({ definition: old, version: 4 }).where(eq(dashboardTemplate.id, current.id));

    await seed(t.db);
    const upgraded = (await t.db.query.dashboardTemplate.findFirst({ where }))!;
    expect(upgraded.version).toBe(5);
    expect(upgraded.definition.states[0]!.widgets.map((w) => w.id)).toContain('alarms-recent');

    await seed(t.db);
    expect((await t.db.query.dashboardTemplate.findFirst({ where }))!.version).toBe(5);
  });
});
