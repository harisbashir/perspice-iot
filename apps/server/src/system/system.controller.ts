import { Controller, Get, Post } from '@nestjs/common';
import { Audited } from '../audit/audited.decorator';
import { Public } from '../auth/decorators';
import { Maintenance } from '../backups/maintenance';
import { PushService } from '../delivery/push.service';
import { Require } from '../rbac/require.decorator';
import { SystemService } from './system.service';

@Controller()
export class SystemController {
  constructor(
    private readonly system: SystemService,
    private readonly maintenance: Maintenance,
    private readonly push: PushService,
  ) {}

  /** The end-to-end check `perspice cli health --mqtt-roundtrip` runs, from the System page. */
  @Post('system/roundtrip')
  @Require('system.settings')
  roundtrip() {
    return this.system.roundtrip();
  }

  /** The newest published release, and whether it is newer than this one (cached for hours). */
  @Get('system/update')
  @Require('system.settings')
  update() {
    return this.system.updateCheck();
  }

  /** Creates web push keys when the server configuration has none (instead of `perspice cli vapid-keys`). */
  @Post('system/push')
  @Require('system.settings')
  @Audited('system.push_setup', 'system')
  setUpPush() {
    return this.push.setUp();
  }

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
