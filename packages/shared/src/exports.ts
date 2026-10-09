import { z } from 'zod';
import type { BrandingDto, DeviceDto, DeviceProfileDto } from './api-types.js';
import { type DashboardViewDto, DataSourceSchema, TimewindowSchema } from './dashboard.js';

/** Exports above this many rows run as background jobs; smaller ones stream straight back. */
export const EXPORT_SYNC_ROW_LIMIT = 50_000;
/** PDFs are laid out in memory, so they are capped; larger exports must use CSV or XLSX. */
export const EXPORT_PDF_ROW_LIMIT = 10_000;
export const EXPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

const keys = z.array(z.string().min(1).max(128)).min(1).max(50);
const ms = z.number().int().nonnegative();

export const TelemetryExportParamsSchema = z
  .object({ deviceId: z.string().uuid(), keys, from: ms, to: ms })
  .refine((p) => p.from < p.to, { message: '"from" must be before "to"', path: ['to'] });

export const DEVICE_EXPORT_COLUMNS = ['name', 'status', 'lastSeen', 'profile', 'customer', 'tags'] as const;

export const DevicesExportParamsSchema = z.object({
  /** Built-in columns (see DEVICE_EXPORT_COLUMNS) or telemetry keys (latest value). */
  columns: z.array(z.string().min(1).max(128)).min(1).max(50).default(['name', 'status', 'lastSeen', 'profile', 'customer']),
  profileId: z.string().uuid().nullish(),
  filter: z
    .object({
      status: z.array(z.enum(['online', 'offline', 'dead', 'never'])).optional(),
      tags: z.array(z.string()).optional(),
      search: z.string().max(200).optional(),
    })
    .optional(),
});

export const AuditExportParamsSchema = z.object({
  targetType: z.string().max(64).optional(),
  targetId: z.string().max(128).optional(),
  actorId: z.string().uuid().optional(),
  from: ms.optional(),
  to: ms.optional(),
});

/** A widget's data, as currently configured on a dashboard. */
export const WidgetExportParamsSchema = z.object({
  title: z.string().max(200).optional(),
  datasource: DataSourceSchema,
  mode: z.enum(['latest', 'history', 'list', 'stats']),
  timewindow: TimewindowSchema.optional(),
  /** The dashboard's device, for `currentDevice` sources. */
  deviceId: z.string().uuid().optional(),
});

export const ExportRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('telemetry'), format: z.enum(EXPORT_FORMATS), params: TelemetryExportParamsSchema }),
  z.object({ kind: z.literal('devices'), format: z.enum(EXPORT_FORMATS), params: DevicesExportParamsSchema }),
  z.object({ kind: z.literal('audit'), format: z.enum(EXPORT_FORMATS), params: AuditExportParamsSchema }),
  z.object({ kind: z.literal('widget'), format: z.enum(EXPORT_FORMATS), params: WidgetExportParamsSchema }),
]);
export type ExportRequest = z.infer<typeof ExportRequestSchema>;
export type TelemetryExportParams = z.infer<typeof TelemetryExportParamsSchema>;
export type DevicesExportParams = z.infer<typeof DevicesExportParamsSchema>;
export type AuditExportParams = z.infer<typeof AuditExportParamsSchema>;
export type WidgetExportParams = z.infer<typeof WidgetExportParamsSchema>;

export interface ExportJobDto {
  id: string;
  kind: ExportRequest['kind'] | 'report';
  format: ExportFormat;
  title: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  rowCount: number | null;
  error: string | null;
  createdAt: number;
  expiresAt: number | null;
  /** Short-lived signed link; null until done and after expiry. */
  downloadUrl: string | null;
}

// ── Dashboard PDF reports ───────────────────────────────────────────────────────────────────

export const ReportRequestSchema = z
  .object({
    /** A device dashboard… */
    deviceId: z.string().uuid().optional(),
    /** …or the viewer's overview dashboard. */
    overview: z.boolean().optional(),
    stateId: z.string().max(64).optional(),
    timewindow: TimewindowSchema,
  })
  .refine((r) => !!r.deviceId !== !!r.overview, { message: 'Choose either a device dashboard or the overview' });
export type ReportRequest = z.infer<typeof ReportRequestSchema>;

/** What the print page gets for a render token: one dashboard, as one viewer sees it. */
export interface PrintSessionDto {
  /** Authorises `POST /api/print/data` for this dashboard only, for a short time. */
  session: string;
  title: string;
  generatedAt: number;
  timewindow: z.infer<typeof TimewindowSchema>;
  stateId: string;
  viewer: { scopeType: 'platform' | 'customer' };
  branding: BrandingDto;
  dashboard: DashboardViewDto;
  device: DeviceDto | null;
  profile: DeviceProfileDto | null;
}
