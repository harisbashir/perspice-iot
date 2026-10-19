import type { DataResponse, PrintSessionDto, Timewindow } from '@perspice/shared';
import { getWidget, registerBuiltInWidgets, settingsFor, type WidgetActions } from '@perspice/widgets';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ApiError, api } from '@/api/client';
import { applyTheme } from '@/branding/applyTheme';
import { useBranding } from '@/branding/BrandingProvider';
import { WidgetFrame } from '@/dashboards/WidgetFrame';
import { buildRequests } from '@/dashboards/live';
import { loadGeofences, loadMapTiles, loadRoute, loadTrips } from '@/dashboards/map-services';

registerBuiltInWidgets();

const ROW_HEIGHT = 40;
const GAP = 12;
const CHART_WAIT_MS = 20_000;

const utc = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

export function periodLabel(tw: Timewindow, generatedAt: number): string {
  if (tw.kind === 'absolute') return `${utc(tw.fromMs)} – ${utc(tw.toMs)}`;
  return `${utc(generatedAt - tw.lastMs)} – ${utc(generatedAt)}`;
}

const readOnly: WidgetActions = {
  sendCommand: () => Promise.reject(new Error('Not available in reports')),
  writeShared: () => Promise.reject(new Error('Not available in reports')),
  openDevice: () => undefined,
  openAlarm: () => undefined,
  ackAlarm: () => Promise.reject(new Error('Not available in reports')),
  setQuery: () => undefined,
  mapTiles: loadMapTiles,
  geofences: loadGeofences,
  route: loadRoute,
  trips: loadTrips,
};

/**
 * The page the PDF renderer prints. It is opened with a single-use render token, shows one
 * dashboard state with the report's time window, and marks `data-print-state="ready"` once data
 * and charts are drawn (or "error" with a message).
 */
export function PrintDashboard() {
  const [params] = useSearchParams();
  const rt = params.get('rt') ?? '';
  const hostBranding = useBranding();
  useState(() => {
    // Before any chart mounts: print mode disables chart animation; reports are always light.
    document.documentElement.dataset.print = 'true';
    document.documentElement.classList.remove('dark');
  });

  // The token works once, so this must never refetch.
  const session = useQuery({
    queryKey: ['print-session', rt],
    queryFn: () => api<PrintSessionDto>('/print/session', { body: { rt } }),
    enabled: !!rt,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const s = session.data;
  const state = s?.dashboard.definition.states.find((x) => x.id === s.stateId);
  const requests = useMemo(() => (s && state ? buildRequests(state, s.device?.id, s.timewindow, {}).requests : []), [s, state]);

  const data = useQuery({
    queryKey: ['print-data', s?.session],
    queryFn: () => (requests.length ? api<DataResponse>('/print/data', { body: { session: s!.session, requests } }) : Promise.resolve({ results: {} })),
    enabled: !!s,
    retry: false,
    staleTime: Infinity,
  });

  // The report carries the viewer's branding, whatever host the renderer used.
  useEffect(() => {
    if (s) applyTheme(s.branding);
  }, [s, hostBranding]);

  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!data.data) return;
    let cancelled = false;
    const started = Date.now();
    const tick = () => {
      if (cancelled) return;
      if (document.querySelector('[data-chart="pending"]') && Date.now() - started < CHART_WAIT_MS) {
        setTimeout(tick, 100);
        return;
      }
      requestAnimationFrame(() => requestAnimationFrame(() => !cancelled && setReady(true)));
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [data.data]);

  const error = !rt ? new Error('Missing render token') : (session.error ?? data.error);
  if (error) {
    return (
      <div data-print-state="error" className="p-8 text-red-700">
        {error instanceof ApiError || error instanceof Error ? error.message : 'The report could not be prepared'}
      </div>
    );
  }
  if (!s || !state) return <div data-print-state="loading" className="p-8 text-fg-muted">Preparing report…</div>;

  const b = s.branding;
  const summary = s.device
    ? { id: s.device.id, name: s.device.name, status: s.device.status, lastSeen: s.device.lastSeen, profileId: s.device.profileId, customerId: s.device.customerId }
    : null;
  const results: DataResponse['results'] = data.data?.results ?? {};
  const rows = Math.max(1, ...state.layout.map((l) => l.y + l.h));

  return (
    <div data-print-state={ready ? 'ready' : 'loading'} className="min-h-screen bg-surface p-4 text-fg">
      <header className="mb-4 flex items-end justify-between gap-4 border-b-2 pb-3" style={{ borderColor: b.primaryColor }}>
        <div>
          {b.logoLightUrl ? (
            <img src={b.logoLightUrl} alt={b.productName} className="mb-2 h-8 w-auto" />
          ) : (
            <div className="mb-1 text-sm font-semibold" style={{ color: b.primaryColor }}>
              {b.productName}
            </div>
          )}
          <h1 className="text-xl font-semibold">{s.title}</h1>
          {s.dashboard.definition.states.length > 1 && <p className="text-sm text-fg-muted">{state.name}</p>}
        </div>
        <dl className="text-right text-xs text-fg-muted">
          <dt className="sr-only">Period</dt>
          <dd>{periodLabel(s.timewindow, s.generatedAt)}</dd>
          <dt className="sr-only">Generated</dt>
          <dd>Generated {utc(s.generatedAt)}</dd>
        </dl>
      </header>
      <div
        className="grid"
        style={{ gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gridTemplateRows: `repeat(${rows}, ${ROW_HEIGHT}px)`, gap: GAP }}
      >
        {state.widgets.map((w) => {
          const l = state.layout.find((x) => x.i === w.id);
          if (!l) return null;
          const def = getWidget(w.type);
          return (
            <div key={w.id} style={{ gridColumn: `${l.x + 1} / span ${l.w}`, gridRow: `${l.y + 1} / span ${l.h}`, breakInside: 'avoid' }}>
              <WidgetFrame title={w.title}>
                {def ? (
                  <def.Component
                    config={w}
                    settings={settingsFor(def, w.settings)}
                    result={results[w.id] ?? (data.data ? { ok: true, data: null } : undefined)}
                    timewindow={s.timewindow}
                    device={summary}
                    profile={s.profile}
                    can={{ command: false, export: false, ack: false }}
                    viewer={s.viewer}
                    actions={readOnly}
                  />
                ) : (
                  <div className="text-xs text-fg-muted">Unknown widget “{w.type}”</div>
                )}
              </WidgetFrame>
            </div>
          );
        })}
      </div>
      <footer className="mt-4 border-t pt-2 text-center text-[10px] text-fg-muted">{b.productName}</footer>
    </div>
  );
}
