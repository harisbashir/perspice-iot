import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { Maintenance } from '../backups/maintenance';
import { Require } from '../rbac/require.decorator';
import { SystemService } from './system.service';

@Controller()
export class SystemController {
  constructor(
    private readonly system: SystemService,
    private readonly maintenance: Maintenance,
  ) {}

  @Get('system/status')
  @Require('system.settings')
  status() {
    return this.system.status();
  }

  /** Whether the platform is in maintenance (a restore is running); answered even then. */
  @Public()
  @Get('public/maintenance')
  async maintenanceState() {
    const s = await this.maintenance.state(true);
    return { maintenance: !!s, since: s?.since ?? null };
  }
}
