import { z } from 'zod';

/** `renderer` (dashboard PDFs, needs Chromium) is never part of `all`; it runs in its own image. */
export const ROLES = ['api', 'ingest', 'rules', 'scheduler', 'renderer', 'all'] as const;
export type Role = (typeof ROLES)[number];

const ConfigSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PERSPICE_ROLE: z.enum(ROLES).default('all'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  MQTT_URL: z.string().url().default('mqtt://localhost:1883'),
  MQTT_INGEST_USERNAME: z.string().min(1).default('perspice-ingest'),
  /** A stable name for this ingest process, so a restarted container resumes its own MQTT session (set per instance when running several). */
  INGEST_ID: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).optional(),
  MQTT_INGEST_PASSWORD: z.string().default(''),
  EMQX_API_URL: z.string().url().default('http://localhost:18083'),
  EMQX_API_KEY: z.string().default(''),
  EMQX_API_SECRET: z.string().default(''),
  INTERNAL_SECRET: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  MASTER_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'MASTER_KEY must be base64 decoding to 32 bytes'),
  PUBLIC_URL: z.string().url().default('http://localhost'),
  BASE_DOMAIN: z.string().min(1).default('localhost'),
  /** GitHub repository whose releases the System page compares with this version. */
  UPDATE_REPO: z.string().regex(/^[\w.-]+\/[\w.-]+$/).default('harisbashir/perspice-iot'),
  /** Where the renderer loads the web app (print page); defaults to PUBLIC_URL. */
  RENDERER_APP_URL: z.string().url().optional(),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  /** S3 or any S3-compatible service (MinIO, Wasabi, Spaces, B2). */
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /** Encrypts backups (never stored in them). Backups are unavailable without it. */
  BACKUP_PASSPHRASE: z.string().min(16, 'BACKUP_PASSPHRASE must be at least 16 characters').optional(),
  /** Include MASTER_KEY in backups (only if the backup's storage is as trusted as the server). */
  BACKUP_INCLUDE_MASTER_KEY: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  PG_DUMP_PATH: z.string().default('pg_dump'),
  PG_RESTORE_PATH: z.string().default('pg_restore'),
  /** Device MQTT: the bundled EMQX broker, or AWS IoT Core. */
  MQTT_TRANSPORT: z.enum(['emqx', 'aws-iot']).default('emqx'),
  AWS_REGION: z.string().default('us-east-1'),
  AWS_IOT_ENDPOINT: z.string().optional(),
  AWS_IOT_POLICY_NAME: z.string().default('perspice-device'),
  AWS_IOT_CERT_PATH: z.string().optional(),
  AWS_IOT_KEY_PATH: z.string().optional(),
  AWS_IOT_CA_PATH: z.string().optional(),
  /** Overrides the ingest connection URL (default mqtts://<endpoint>:8883), e.g. for a VPC endpoint or tests. */
  AWS_IOT_MQTT_URL: z.string().optional(),
  /** CSP image sources for map tiles (Caddy uses the same list); tile URLs must match one. */
  MAP_TILE_HOSTS: z.string().default('https://tile.openstreetmap.org https://*.tile.openstreetmap.org'),
  METRICS_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  STORAGE_LOCAL_PATH: z.string().default('/var/lib/perspice/storage'),
  /** Requests per minute per IP on /auth/login and /auth/forgot. */
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
});

const CheckedConfigSchema = ConfigSchema.superRefine((c, ctx) => {
  if (c.STORAGE_DRIVER === 's3' && !c.S3_BUCKET) ctx.addIssue({ code: 'custom', path: ['S3_BUCKET'], message: 'required when STORAGE_DRIVER=s3' });
  if (c.MQTT_TRANSPORT === 'aws-iot') {
    for (const k of ['AWS_IOT_ENDPOINT', 'AWS_IOT_CERT_PATH', 'AWS_IOT_KEY_PATH', 'AWS_IOT_CA_PATH'] as const) {
      if (!c[k]) ctx.addIssue({ code: 'custom', path: [k], message: 'required when MQTT_TRANSPORT=aws-iot' });
    }
  }
});

export type Config = z.infer<typeof ConfigSchema> & { masterKey: Buffer };

export const CONFIG = Symbol('CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  // Compose passes unset variables as empty strings: treat those as unset.
  const result = CheckedConfigSchema.safeParse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== '')));
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${problems}`);
  }
  return { ...result.data, masterKey: Buffer.from(result.data.MASTER_KEY, 'base64') };
}
