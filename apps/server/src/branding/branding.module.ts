import { Global, Module } from '@nestjs/common';
import { BrandingController } from './branding.controller';
import { BrandingService } from './branding.service';
import { CaddyController } from './caddy.controller';

@Global()
@Module({
  controllers: [BrandingController, CaddyController],
  providers: [BrandingService],
  exports: [BrandingService],
})
export class BrandingModule {}
