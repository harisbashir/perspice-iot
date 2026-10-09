import { type DynamicModule, Global, Module } from '@nestjs/common';
import { ChromiumRenderer, PDF_RENDERER } from './pdf-renderer';
import { ReportProcessor } from './report.processor';
import { RenderTokens } from './render-tokens';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Global()
@Module({})
export class ReportsModule {
  static forRoot(opts: { api: boolean; renderer: boolean }): DynamicModule {
    return {
      module: ReportsModule,
      controllers: opts.api ? [ReportsController] : [],
      providers: [
        RenderTokens,
        ReportsService,
        ...(opts.renderer ? [{ provide: PDF_RENDERER, useClass: ChromiumRenderer }, ReportProcessor] : []),
      ],
      exports: [ReportsService, RenderTokens],
    };
  }
}
