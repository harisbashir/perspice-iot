import { Global, Module } from '@nestjs/common';
import { AwsIotProvisioning } from './iot-provisioning';

@Global()
@Module({ providers: [AwsIotProvisioning], exports: [AwsIotProvisioning] })
export class AwsModule {}
