import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import {
  type DashboardState,
  type DashboardViewDto,
  type DataResponse,
  DataRequestSchema,
  DataSourceSchema,
  type DeviceDto,
  type ExportJobDto,
  MAX_DATA_REQUESTS,
  type PrintSessionDto,
  type ReportRequest,
  ReportRequestSchema,
} from '@perspice/shared';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { BrandingService } from '../branding/branding.service';
import { notFound, validation } from '../common/app-error';
import { CONFIG, type Config } from '../config/config';
import { DataService } from '../dashboards/data.service';
import { InstancesService } from '../dashboards/instances.service';
import { DevicesService } from '../devices/devices.service';
import { ProfilesService, toProfileDto } from '../devices/profiles.service';
import { ExportsService } from '../exports/exports.service';
import { STORAGE, type StorageDriver } from '../storage/storage.driver';
import type { PdfRenderer } from './pdf-renderer';
import { type RenderBinding, RenderTokens } from './render-tokens';

export const REPORTS_QUEUE = 'reports';

const SessionBody = z.object({ rt: z.string().min(1).max(200) });
const DataBody = z.object({ session: z.string().min(1).max(200), requests: z.array(DataRequestSchema).max(MAX_DATA_REQUESTS) });

const snapshot = (a: AuthUser): RenderBinding['actor'] => ({
  kind: a.kind,
  apiKeyId: a.apiKeyId,
  scopeType: a.scopeType,
  customerId: a.customerId,
  groupId: a.groupId,
  permissions: a.permissions,
});

/**
 * Dashboard PDF reports: a request becomes a job (sharing export jobs' storage, notifications
 * and 24 h retention); the `renderer` role prints the dashboard's print page with Chromium.
 */
@Injectable()
export class ReportsService implements OnApplicationShutdown {
  readonly queue: Queue<{ jobId: string }>;
  private readonly connection: Redis;
  private readonly appUrl: string;

  constructor(
    @Inject(CONFIG) config: Config,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    private readonly exportJobs: ExportsService,
    private readonly tokens: RenderTokens,
    private readonly instances: InstancesService,
    private readonly devices: DevicesService,
    private readonly profiles: ProfilesService,
    private readonly branding: BrandingService,
    private readonly data: DataService,
  ) {
    this.connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue(REPORTS_QUEUE, { connection: this.connection });
    this.appUrl = (config.RENDERER_APP_URL ?? config.PUBLIC_URL).replace(/\/$/, '');
  }

  async request(actor: AuthUser, body: unknown): Promise<ExportJobDto> {
    const req = ReportRequestSchema.parse(body);
    const { view, device } = await this.dashboardFor(actor, req); // 404 when not visible to the caller
    stateOf(view, req.stateId);
    const title = device ? `${device.name} — ${view.templateName}` : view.templateName;
    const job = await this.exportJobs.createJob(actor, { kind: 'report', format: 'pdf', title, request: req });
    await this.queue.add('report', { jobId: job.id }, { jobId: job.id, removeOnComplete: 1000, removeOnFail: 1000 });
    return this.exportJobs.toDto(job);
  }

  /** Renderer worker: prints the dashboard through a fresh render token and stores the PDF. */
  process(jobId: string, renderer: PdfRenderer): Promise<void> {
    return this.exportJobs.runJob(jobId, async (job, actor, request) => {
      const token = await this.tokens.issue({ userId: actor.id, actor: snapshot(actor), request: request as ReportRequest });
      const pdf = await renderer.render(`${this.appUrl}/print/dashboard?rt=${encodeURIComponent(token)}`);
      await this.storage.put(this.exportJobs.fileKey(job), pdf, 'application/pdf');
      return null;
    });
  }

  /** Redeems a render token (once) for the dashboard, as the requesting user sees it. */
  async openSession(body: unknown): Promise<PrintSessionDto> {
    const { rt } = SessionBody.parse(body);
    const binding = await this.tokens.redeem(rt);
    if (!binding) throw notFound('This render link is invalid or has expired');
    const actor = await this.actorOf(binding);
    const { view, device } = await this.dashboardFor(actor, binding.request);
    const state = stateOf(view, binding.request.stateId);
    return {
      session: await this.tokens.openSession(binding),
      title: device ? `${device.name} — ${view.templateName}` : view.templateName,
      generatedAt: Date.now(),
      timewindow: binding.request.timewindow,
      stateId: state.id,
      viewer: { scopeType: actor.scopeType },
      branding: await this.branding.resolve(actor.customerId),
      dashboard: view,
      device,
      profile: device ? toProfileDto(await this.profiles.get(actor, device.profileId)) : null,
    };
  }

  /**
   * Widget data for a print session. Only the widgets of the bound dashboard state, with their
   * configured sources and the report's time window, are served.
   */
  async printData(body: unknown): Promise<DataResponse> {
    const { session, requests } = DataBody.parse(body);
    const binding = await this.tokens.session(session);
    if (!binding) throw notFound('This print session has expired');
    const actor = await this.actorOf(binding);
    const { view } = await this.dashboardFor(actor, binding.request);
    const widgets = new Map(stateOf(view, binding.request.stateId).widgets.map((w) => [w.id, w]));
    for (const r of requests) {
      const w = widgets.get(r.widgetId);
      if (!w || !isDeepStrictEqual(DataSourceSchema.parse(w.datasource), r.datasource)) {
        throw validation([{ path: ['requests'], message: `Widget ${r.widgetId} is not part of this dashboard` }]);
      }
      r.timewindow = binding.request.timewindow;
    }
    return { results: await this.data.query(actor, binding.request.deviceId, requests) };
  }

  private async actorOf(binding: RenderBinding): Promise<AuthUser> {
    return this.exportJobs.actorFor(binding.userId, binding.actor).catch(() => {
      throw notFound('This render link is invalid or has expired');
    });
  }

  private async dashboardFor(actor: AuthUser, req: ReportRequest): Promise<{ view: DashboardViewDto; device: DeviceDto | null }> {
    const device = req.deviceId ? await this.devices.get(actor, req.deviceId) : null;
    const view = device ? await this.instances.forDevice(actor, device.id) : await this.instances.overview(actor);
    if (!view) throw notFound('There is no dashboard to print');
    return { view, device };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    await this.connection.quit().catch(() => this.connection.disconnect());
  }
}

function stateOf(view: DashboardViewDto, stateId: string | undefined): DashboardState {
  const states = view.definition.states;
  const state = stateId ? states.find((s) => s.id === stateId) : states[0];
  if (!state) throw validation([{ path: ['stateId'], message: 'No such dashboard view' }]);
  return state;
}
