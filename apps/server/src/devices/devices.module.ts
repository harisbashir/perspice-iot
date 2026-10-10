import { ClaimService } from '../provisioning/claim.service';
import { ImportService } from '../provisioning/import.service';
import { BulkService } from './bulk.service';
import { Global, Module } from '@nestjs/common';
import { CredentialsService } from './credentials.service';
import { DebugLogService } from './debug-log.service';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';

@Global()
@Module({
  controllers: [ProfilesController, DevicesController],
  providers: [ProfilesService, DevicesService, CredentialsService, DebugLogService, BulkService, ClaimService, ImportService],
  exports: [ProfilesService, DevicesService, CredentialsService, DebugLogService, BulkService],
})
export class DevicesModule {}
