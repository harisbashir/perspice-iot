import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { JobRegistry } from '../scheduler/job-registry';
import { CommandsService } from './commands.service';

/** Every 5 s: sent commands past their ttl and queued ones past `expires_at` time out. */
@Injectable()
export class CommandTimeoutJob implements OnApplicationBootstrap {
  constructor(
    private readonly commands: CommandsService,
    private readonly jobs: JobRegistry,
    @Inject('SCHEDULE_COMMAND_JOBS') private readonly schedule: boolean,
  ) {}

  onApplicationBootstrap(): void {
    if (this.schedule) this.jobs.every('command-timeout', 5000, () => this.run().then(() => undefined));
  }

  run(now = new Date()): Promise<number> {
    return this.commands.expire(now);
  }
}
