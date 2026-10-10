import { Controller, Get, Param, Query } from '@nestjs/common';
import { KEY_PATTERN } from '@perspice/shared';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { Require } from '../rbac/require.decorator';
import { TelemetryService } from './telemetry.service';

const DAY = 86_400_000;

const HistoryQuery = z
  .object({
    keys: z
      .string()
      .transform((s) => [...new Set(s.split(',').map((k) => k.trim()).filter(Boolean))])
      .pipe(z.array(z.string().regex(KEY_PATTERN)).min(1).max(20)),
    from: z.coerce.number().int().optional(),
    to: z.coerce.number().int().optional(),
    agg: z.enum(['auto', 'raw', 'avg', 'min', 'max']).default('auto'),
    limit: z.coerce.number().int().min(1).max(50_000).default(10_000),
  })
  .transform((q) => {
    const to = q.to ?? Date.now();
    return { ...q, to, from: q.from ?? to - DAY };
  })
  .refine((q) => q.from < q.to, { message: '`from` must be before `to`', path: ['from'] })
  .refine((q) => q.to - q.from <= 5 * 366 * DAY, { message: 'Range must be at most 5 years', path: ['from'] });

@Controller('devices/:id/telemetry')
export class TelemetryController {
  constructor(private readonly telemetry: TelemetryService) {}

  @Get()
  @Require('telemetry.read')
  history(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Query() raw: unknown) {
    return this.telemetry.history(actor, id, HistoryQuery.parse(raw));
  }

  @Get('latest')
  @Require('telemetry.read')
  latest(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.telemetry.latest(actor, id);
  }

  @Get('keys')
  @Require('telemetry.read')
  keys(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.telemetry.keys(actor, id);
  }
}
