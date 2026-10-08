import { type DynamicModule, Global, Module } from '@nestjs/common';
import { EmailProcessor } from './email.processor';
import { EmailService } from './email.service';

@Global()
@Module({})
export class EmailModule {
  static forRoot(opts: { processor: boolean }): DynamicModule {
    return {
      module: EmailModule,
      providers: [EmailService, ...(opts.processor ? [EmailProcessor] : [])],
      exports: [EmailService],
    };
  }
}
