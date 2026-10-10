import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { Require } from '../rbac/require.decorator';
import { AuditService } from './audit.service';

const ListQuery = z.object({
  targetType: z.string().max(64).optional(),
  targetId: z.string().max(128).optional(),
  actorId: z.string().uuid().optional(),
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Require('audit.read')
  async list(@CurrentUser() user: AuthUser, @Query() raw: unknown) {
    const q = ListQuery.parse(raw);
    const { items, nextCursor } = await this.audit.list({
      ...q,
      from: q.from !== undefined ? new Date(q.from) : undefined,
      to: q.to !== undefined ? new Date(q.to) : undefined,
      // Customer users only ever see their own customer's trail.
      customerId: user.scopeType === 'customer' ? user.customerId : undefined,
    });
    return {
      items: items.map((r) => ({ ...r, ts: r.ts.getTime() })),
      nextCursor,
    };
  }
}
