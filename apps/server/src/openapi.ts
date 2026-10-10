import { Controller, Get, type INestApplication, Module } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { notFound } from './common/app-error';
import { appVersion } from './common/version';
import type { Config } from './config/config';
import { SettingsService } from './settings/settings.service';

let document: OpenAPIObject | null = null;

/** The spec for signed-in users, available even when the public docs UI is disabled. */
@Controller('docs')
export class DocsController {
  @Get('openapi.json')
  spec() {
    if (!document) throw notFound();
    return document;
  }
}

@Module({ controllers: [DocsController] })
export class DocsModule {}

/**
 * Builds the OpenAPI document. Swagger UI is mounted at `/api/docs` except in production,
 * where it requires the `api.docsPublic` setting; signed-in users can always fetch the spec.
 */
export async function setupOpenApi(app: INestApplication, config: Config): Promise<OpenAPIObject> {
  const builder = new DocumentBuilder()
    .setTitle('Perspice IoT API')
    .setVersion(appVersion())
    .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'Access token or `pk_` API key' })
    .addSecurityRequirements('bearer')
    .build();
  document = SwaggerModule.createDocument(app, builder);
  const isPublic =
    config.NODE_ENV !== 'production' || (await app.get(SettingsService).get('api.docsPublic')) === true;
  if (isPublic) SwaggerModule.setup('api/docs', app, document);
  return document;
}
