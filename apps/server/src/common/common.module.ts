import { Global, Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthRegistry } from './health.registry';
import { InternalSecretGuard } from './internal-secret.guard';

@Global()
@Module({
  controllers: [HealthController],
  providers: [HealthRegistry, InternalSecretGuard],
  exports: [HealthRegistry, InternalSecretGuard],
})
export class CommonModule {}
