import { Global, Module } from '@nestjs/common';
import { BrandingService } from './branding.service';

@Global()
@Module({
  providers: [BrandingService],
  exports: [BrandingService],
})
export class BrandingModule {}
