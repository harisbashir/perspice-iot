import { Inject, Injectable } from '@nestjs/common';
import { type BulkAction, BulkRequestSchema, type BulkResult, type Permission } from '@perspice/shared';
import { inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { CommandsService } from '../commands/commands.service';
import { AppError, forbidden, validation } from '../common/app-error';
import { DB } from '../db/db.module';
import { scoped } from '../db/scoped-repo';
import { device } from '../db/schema';
import { ScopeService } from '../rbac/scope';
import { DevicesService } from './devices.service';

/** The most specific message of an error (validation details first). */
function reason(err: unknown): string {
  if (!(err instanceof AppError)) return 'Failed';
  const first = Array.isArray(err.details) ? (err.details[0] as { message?: string } | undefined) : undefined;
  return first?.message ?? err.message;
}

const NEEDS: Record<BulkAction['kind'], Permission> = {
  assign: 'device.write',
  group: 'device.write',
  tags: 'device.write',
  command: 'device.command',
  delete: 'device.write',
  asset: 'asset.write',
};

/**
 * One action on up to 500 devices. Each id is resolved within the caller's scope first (others
 * are reported as not found and left alone); each device then goes through the same service
 * call as a single-device request, so its checks and side effects apply.
 */
@Injectable()
export class BulkService {
  constructor(
    @Inject(DB) private readonly db: DB,
    private readonly scopes: ScopeService,
    private readonly devices: DevicesService,
    private readonly commands: CommandsService,
    private readonly audit: AuditService,
  ) {}

  async run(actor: AuthUser, body: unknown, ip: string | null): Promise<BulkResult> {
    const { deviceIds, action } = BulkRequestSchema.parse(body);
    if (!actor.permissions.includes(NEEDS[action.kind])) throw forbidden();
    if (action.kind === 'assign' && actor.scopeType !== 'platform') throw forbidden('Only the platform assigns devices to customers');
    const ids = [...new Set(deviceIds)];
    const visible = await this.db
      .select({ id: device.id, tags: device.tags })
      .from(device)
      .where(scoped(device, await this.scopes.forUser(actor), inArray(device.id, ids)));
    const byId = new Map(visible.map((d) => [d.id, d]));

    const results: BulkResult['results'] = [];
    for (const id of ids) {
      const d = byId.get(id);
      if (!d) {
        results.push({ deviceId: id, ok: false, error: 'Not found' });
        continue;
      }
      try {
        await this.apply(actor, id, d.tags, action);
        results.push({ deviceId: id, ok: true });
      } catch (err) {
        results.push({ deviceId: id, ok: false, error: reason(err) });
      }
    }
    const ok = results.filter((r) => r.ok).length;
    await this.audit.record({
      actorType: actor.kind === 'apikey' ? 'apikey' : 'user',
      actorId: actor.kind === 'apikey' ? actor.apiKeyId : actor.id,
      customerId: actor.customerId,
      action: `device.bulk_${action.kind}`,
      targetType: 'device',
      targetId: null,
      diff: { deviceIds: ids, action, ok },
      ...(ip ? { ip } : {}),
    });
    return { ok, results };
  }

  private async apply(actor: AuthUser, id: string, tags: string[], action: BulkAction): Promise<void> {
    switch (action.kind) {
      case 'assign':
        await this.devices.update(actor, id, { customerId: action.customerId });
        return;
      case 'group':
        await this.devices.update(actor, id, { groupId: action.groupId });
        return;
      case 'tags': {
        const next = [...new Set([...tags.filter((t) => !action.remove.includes(t)), ...action.add])];
        await this.devices.update(actor, id, { tags: next });
        return;
      }
      case 'command':
        await this.commands.send(actor, id, { name: action.name, params: action.params });
        return;
      case 'delete':
        await this.devices.remove(actor, id);
        return;
      case 'asset':
        throw validation([], 'Attaching to assets is not available yet');
    }
  }
}
