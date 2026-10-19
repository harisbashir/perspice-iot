import { type DataRequest, type DeviceDto, type DeviceSummary, type WidgetDataResult, DEFAULT_MAP_TILES } from '@perspice/shared';
import { http, HttpResponse } from 'msw';
import { sampleResult } from '@/dashboards/sample-data';
import { alarmSummary, alarms, branding, customerName, customers, deviceById, deviceDashboard, devices, keysOf, latestOf, me, overview, profiles, valueAt } from './fixtures';

/** Demo-mode API: enough of the server for every page to render with data. Writes succeed and change nothing. */

const summary = (d: DeviceDto): DeviceSummary => ({ id: d.id, name: d.name, status: d.status, lastSeen: d.lastSeen, profileId: d.profileId, customerId: d.customerId });
const page = <T,>(items: T[]) => ({ items, nextCursor: null });
const keysIn = (r: DataRequest) => ('keys' in r.datasource ? r.datasource.keys : []);
/** The current values of a device; ones that stopped reporting keep the values they last sent. */
const live = (d: DeviceDto, keys: string[]) => (d.status === 'online' ? latestOf(d, keys) : Object.fromEntries(keys.map((k) => [k, d.latest?.[k] ?? { ts: 0, v: null }])));

function fleetOf(r: DataRequest): DeviceDto[] {
  const ds = r.datasource;
  const profileId = 'profileId' in ds ? ds.profileId : null;
  return devices.filter((d) => !profileId || d.profileId === profileId);
}

function history(d: DeviceDto, r: DataRequest) {
  const tw = r.timewindow ?? { kind: 'relative' as const, lastMs: 86_400_000 };
  const to = tw.kind === 'absolute' ? tw.toMs : Date.now();
  const from = tw.kind === 'absolute' ? tw.fromMs : to - tw.lastMs;
  const step = Math.max(60_000, Math.round((to - from) / 120));
  const series = Object.fromEntries(
    keysIn(r).map((k) => {
      const points: [number, unknown][] = [];
      for (let t = from + step; t <= to; t += step) points.push([t, valueAt(k, d.id, t)]);
      return [k, points];
    }),
  );
  return { source: to - from > 2 * 86_400_000 ? '1h' : 'raw', series };
}

function resolve(r: DataRequest, current: DeviceDto | undefined): WidgetDataResult {
  const ds = r.datasource;
  const one = ds.kind === 'currentDevice' ? current : ds.kind === 'device' ? deviceById(ds.deviceId) : undefined;
  if (one) {
    if (r.mode === 'latest') return { ok: true, data: { device: summary(one), values: live(one, keysIn(r)) } };
    if (r.mode === 'history') return { ok: true, data: history(one, r) };
    if (r.mode === 'locations') return { ok: true, data: { devices: one.location ? [{ ...summary(one), location: one.location, values: {} }] : [], truncated: false } };
    // Energy and anything else: the template-preview generator already makes these up well.
    return sampleResult(r, keysOf(one.profileId));
  }
  if (ds.kind === 'alarms') {
    const status = ds.filter.status;
    const list = alarms.filter((a) => !status || status.includes(a.status));
    if (r.mode === 'stats') return { ok: true, data: alarmSummary() };
    return { ok: true, data: { alarms: list.slice(0, ds.pageSize), total: list.length } };
  }
  const fleet = ds.kind === 'entityList' || ds.kind === 'devicesOfProfile' ? fleetOf(r) : devices.slice(0, 5);
  switch (r.mode) {
    case 'stats': {
      const count = (s: DeviceDto['status']) => fleet.filter((d) => d.status === s).length;
      return { ok: true, data: { total: fleet.length, online: count('online'), offline: count('offline'), dead: count('dead'), never: count('never'), messages24h: count('online') * 2880 } };
    }
    case 'latest':
      return { ok: true, data: { devices: fleet.map((d) => ({ ...summary(d), values: live(d, keysIn(r)) })) } };
    case 'locations':
      return { ok: true, data: { devices: fleet.filter((d) => d.location).map((d) => ({ ...summary(d), location: d.location!, values: {} })), truncated: false } };
    case 'list': {
      const columns = ds.kind === 'entityList' ? ds.columns : [];
      const items = fleet.map((d) => ({
        ...summary(d),
        profileName: profiles.find((p) => p.id === d.profileId)?.name ?? null,
        customerName: customerName(d.customerId),
        values: live(d, columns),
      }));
      return { ok: true, data: { items, total: items.length, page: 0, pageSize: 25, customers } };
    }
    default:
      return sampleResult(r, keysOf(fleet[0]?.profileId ?? ''));
  }
}

export const handlers = [
  http.post('*/api/auth/refresh', () => HttpResponse.json({ accessToken: 'demo-token', user: me })),
  http.post('*/api/auth/login', () => HttpResponse.json({ accessToken: 'demo-token', user: me })),
  http.post('*/api/auth/logout', () => new HttpResponse(null, { status: 204 })),
  http.get('*/api/auth/me', () => HttpResponse.json(me)),
  http.get('*/api/public/branding', () => HttpResponse.json(branding)),
  http.get('*/api/public/maintenance', () => HttpResponse.json({ maintenance: false })),

  http.get('*/api/devices/stats', () => {
    const count = (s: DeviceDto['status']) => devices.filter((d) => d.status === s).length;
    return HttpResponse.json({ total: devices.length, online: count('online'), offline: count('offline'), dead: count('dead'), never: count('never') });
  }),
  http.get('*/api/devices/:id/asset', () => HttpResponse.json({ asset: null })),
  http.get('*/api/devices/:id/telemetry', ({ params, request }) => {
    const d = deviceById(String(params.id));
    if (!d) return HttpResponse.json({ code: 'NOT_FOUND', message: 'Device not found' }, { status: 404 });
    const url = new URL(request.url);
    const keys = (url.searchParams.get('keys') ?? keysOf(d.profileId).map((k) => k.key).join(',')).split(',');
    const to = Number(url.searchParams.get('to')) || Date.now();
    const from = Number(url.searchParams.get('from')) || to - 86_400_000;
    return HttpResponse.json(history(d, { widgetId: 'h', datasource: { kind: 'device', deviceId: d.id, keys }, mode: 'history', timewindow: { kind: 'absolute', fromMs: from, toMs: to }, agg: 'auto', energyRange: 'window', page: 0 }));
  }),
  http.get('*/api/devices/:id', ({ params }) => {
    const d = deviceById(String(params.id));
    if (!d) return HttpResponse.json({ code: 'NOT_FOUND', message: 'Device not found' }, { status: 404 });
    return HttpResponse.json({ ...d, latest: live(d, keysOf(d.profileId).map((k) => k.key)) });
  }),
  http.get('*/api/devices', ({ request }) => {
    const q = new URL(request.url).searchParams;
    const search = q.get('search')?.toLowerCase();
    const list = devices.filter(
      (d) => (!search || d.name.toLowerCase().includes(search)) && (!q.get('status') || d.status === q.get('status')) && (!q.get('profileId') || d.profileId === q.get('profileId')),
    );
    return HttpResponse.json(page(list));
  }),
  http.get('*/api/device-profiles/:id', ({ params }) => HttpResponse.json(profiles.find((p) => p.id === params.id) ?? null)),
  http.get('*/api/device-profiles', () => HttpResponse.json(profiles)),
  http.get('*/api/customers', () => HttpResponse.json(customers.map((c) => ({ ...c, slug: c.name.toLowerCase().replace(/\W+/g, '-'), deviceCount: devices.filter((d) => d.customerId === c.id).length, status: 'active', createdAt: new Date().toISOString() })))),

  http.get('*/api/dashboards/overview', () => HttpResponse.json(overview)),
  http.get('*/api/dashboards/device/:id', ({ params }) => {
    const d = deviceById(String(params.id));
    return HttpResponse.json(d ? deviceDashboard(d.profileId) : { dashboard: null });
  }),
  http.post('*/api/dashboards/data', async ({ request }) => {
    const body = (await request.json()) as { deviceId?: string; requests: DataRequest[] };
    const current = body.deviceId ? deviceById(body.deviceId) : undefined;
    return HttpResponse.json({ results: Object.fromEntries(body.requests.map((r) => [r.widgetId, resolve(r, current)])) });
  }),

  http.get('*/api/alarms/summary', () => HttpResponse.json(alarmSummary())),
  http.get('*/api/alarms/:id', ({ params }) => {
    const a = alarms.find((x) => x.id === params.id);
    return a ? HttpResponse.json({ ...a, timeline: [{ id: 'e1', type: 'raised', ts: a.startedAt, user: null, comment: null, data: null }] }) : HttpResponse.json({ code: 'NOT_FOUND', message: 'Alarm not found' }, { status: 404 });
  }),
  http.get('*/api/alarms', ({ request }) => {
    const q = new URL(request.url).searchParams;
    const status = q.get('status')?.split(',');
    const deviceId = q.get('deviceId');
    return HttpResponse.json(page(alarms.filter((a) => (!status || status.includes(a.status)) && (!deviceId || a.device.id === deviceId))));
  }),
  http.get('*/api/notifications/unread-count', () => HttpResponse.json({ count: 2 })),
  http.get('*/api/notifications', () =>
    HttpResponse.json(
      page(
        alarms.slice(0, 2).map((a, i) => ({ id: `n${i}`, type: 'alarm', title: `${a.ruleName}: ${a.device.name}`, body: a.message, link: `/alarms/${a.id}`, severity: a.severity === 'critical' ? 'critical' : 'warning', readAt: null, createdAt: a.startedAt })),
      ),
    ),
  ),
  http.get('*/api/assets/tree', () => HttpResponse.json([])),
  http.get('*/api/settings/map', () => HttpResponse.json(DEFAULT_MAP_TILES)),
  http.get('*/api/system/status', () => {
    const now = Date.now();
    const proc = (role: string) => ({ role, instance: `${role}-1`, version: '1.0.3', startedAt: now - 3 * 86_400_000, lastSeen: now - 4000 });
    return HttpResponse.json({
      version: '1.0.3',
      processes: ['api', 'ingest', 'rules', 'scheduler', 'renderer'].map(proc),
      expectedRoles: ['api', 'ingest', 'rules', 'scheduler', 'renderer'],
      messagesPerMinute: 12,
      connectedDevices: devices.filter((d) => d.status === 'online').length,
      websocketClients: 3,
      queues: { notifications: { waiting: 0, active: 0, failed: 0, delayed: 0 }, exports: { waiting: 0, active: 1, failed: 0, delayed: 0 } },
      database: { sizeBytes: 182_000_000 },
      storage: { driver: 'local', usedBytes: 2_400_000_000, freeBytes: 38_000_000_000 },
      backup: { latest: { file: 'perspice-2026-10-19.tar.gz.enc', size: 48_000_000, sha256: '…', version: '1.0.3', createdAt: now - 6 * 3_600_000 }, lastError: null, running: false },
      maintenance: false,
    });
  }),
  http.get('*/api/system/backups', () =>
    HttpResponse.json({ latest: null, running: false, lastError: null, schedule: { enabled: true, time: '02:00', timezone: 'UTC' }, nextRunAt: Date.now() + 8 * 3_600_000, configured: true }),
  ),
  http.get('*/api/system/restore', () => HttpResponse.json({ state: 'idle', message: null, startedAt: null, finishedAt: null })),
  http.get('*/api/audit', () =>
    HttpResponse.json(
      page(
        devices.slice(0, 6).map((d, i) => ({
          id: `au${i}`,
          actorType: 'user',
          actorId: me.id,
          customerId: d.customerId,
          action: i % 2 ? 'device.update' : 'command.send',
          targetType: 'device',
          targetId: d.id,
          diff: null,
          ip: '10.0.0.12',
          ts: Date.now() - i * 3_600_000,
        })),
      ),
    ),
  ),

  // Anything else: an empty list for reads, success for writes.
  http.get('*/api/*', () => HttpResponse.json([])),
  http.all('*/api/*', () => HttpResponse.json({ ok: true })),
];
