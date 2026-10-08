import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../auth/decorators';
import { InternalSecretGuard, safeEqual } from '../common/internal-secret.guard';
import { CONFIG, type Config } from '../config/config';
import { CredentialsService } from '../devices/credentials.service';
import { deviceMayAccess, ingestMayAccess } from './acl';

const AuthBody = z.object({
  clientid: z.string().default(''),
  username: z.string().default(''),
  password: z.string().default(''),
});

const AclBody = z.object({
  clientid: z.string().default(''),
  username: z.string().default(''),
  topic: z.string().default(''),
  action: z.enum(['publish', 'subscribe']).catch('publish'),
});

const allow = { result: 'allow', is_superuser: false } as const;
const deny = { result: 'deny' } as const;

/** EMQX HTTP authenticator and authorizer hooks (spec §5.1). */
@Controller('internal/emqx')
@Public()
@UseGuards(InternalSecretGuard)
export class EmqxController {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly credentials: CredentialsService,
  ) {}

  @Post('auth')
  @HttpCode(200)
  async auth(@Body() raw: unknown) {
    const { clientid, username, password } = AuthBody.parse(raw ?? {});
    if (this.isIngest(username)) {
      const expected = this.config.MQTT_INGEST_PASSWORD;
      return expected && safeEqual(password, expected) ? allow : deny;
    }
    if (!username || username !== clientid) return deny;
    return (await this.credentials.verifyToken(clientid, password)) ? allow : deny;
  }

  @Post('acl')
  @HttpCode(200)
  acl(@Body() raw: unknown) {
    const { clientid, username, topic, action } = AclBody.parse(raw ?? {});
    if (this.isIngest(username)) return ingestMayAccess(topic, action) ? allow : deny;
    if (!username || username !== clientid) return deny;
    return deviceMayAccess(clientid, topic, action) ? allow : deny;
  }

  private isIngest(username: string): boolean {
    return username === this.config.MQTT_INGEST_USERNAME;
  }
}
