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
  /** Where the renderer loads the web app (print page); defaults to PUBLIC_URL. */
  RENDERER_APP_URL: z.string().url().optional(),
  STORAGE_DRIVER: z.enum(['local']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('/var/lib/perspice/storage'),
  /** Requests per minute per IP on /auth/login and /auth/forgot. */
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema> & { masterKey: Buffer };

export const CONFIG = Symbol('CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${problems}`);
  }
  return { ...result.data, masterKey: Buffer.from(result.data.MASTER_KEY, 'base64') };
}
