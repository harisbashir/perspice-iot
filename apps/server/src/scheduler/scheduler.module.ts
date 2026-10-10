import { Global, Module } from '@nestjs/common';
import { JobRegistry } from './job-registry';
import { LeaderLock } from './leader-lock';

@Global()
@Module({ providers: [LeaderLock, JobRegistry], exports: [LeaderLock, JobRegistry] })
export class SchedulerModule {}
