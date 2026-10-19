import { Inject, Injectable } from '@nestjs/common';
import type { BrandingDto } from '@perspice/shared';
import { eq } from 'drizzle-orm';
import { decryptSecret, encryptSecret } from '../common/crypto';
import { CONFIG, type Config } from '../config/config';
import { DB } from '../db/db.module';
import { systemSetting } from '../db/schema';

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export interface SesSettings {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  from: string;
}

export interface SettingValues {
  'email.driver': 'smtp' | 'ses';
  'email.smtp': SmtpSettings;
  'email.ses': SesSettings;
  'platform.branding': Partial<BrandingDto>;
  'auth.enforceTotpForSuperAdmin': boolean;
  'api.docsPublic': boolean;
  /** Webhook destinations: plain HTTP and private networks are refused unless allowed here. */
  'webhooks.policy': { allowHttp: boolean; allowPrivate: boolean };
  'backup.schedule': import('@perspice/shared').BackupSchedule;
  'backup.latest': import('../backups/backup.service').LatestBackup;
  'map.tiles': import('@perspice/shared').MapTiles;
  /** Web push keys set up from the System page (VAPID_* in .env take precedence). */
  'push.vapid': import('../delivery/push.service').VapidKeys;
}

export type SettingKey = keyof SettingValues;

@Injectable()
export class SettingsService {
  constructor(
    @Inject(DB) private readonly db: DB,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async get<K extends SettingKey>(key: K): Promise<SettingValues[K] | undefined> {
    const row = await this.db.query.systemSetting.findFirst({ where: eq(systemSetting.key, key) });
    if (!row) return undefined;
    if (row.secret) return JSON.parse(decryptSecret(row.value as string, this.config.masterKey)) as SettingValues[K];
    return row.value as SettingValues[K];
  }

  /** Secret settings are stored as a single AES-256-GCM blob encrypted with MASTER_KEY. */
  async set<K extends SettingKey>(key: K, value: SettingValues[K], opts: { secret?: boolean } = {}): Promise<void> {
    const secret = opts.secret ?? false;
    const stored = secret ? encryptSecret(JSON.stringify(value), this.config.masterKey) : value;
    await this.db
      .insert(systemSetting)
      .values({ key, value: stored, secret })
      .onConflictDoUpdate({ target: systemSetting.key, set: { value: stored, secret, updatedAt: new Date() } });
  }
}
