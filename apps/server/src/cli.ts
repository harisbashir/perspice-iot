import 'reflect-metadata';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import mqtt from 'mqtt';
import { generateKeyPairSync } from 'node:crypto';
import { randomToken, sha256Hex } from './common/crypto';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { TokenService } from './auth/token.service';
import { BrandingService } from './branding/branding.service';
import { type Config, loadConfig } from './config/config';
import type { DB } from './db/db.module';
import { awsIotSetup } from './aws/setup';
import { cliBackup, cliRestore } from './backups/backup.cli';
import { runMigrations } from './db/migrate';
import type { Readable, Writable } from 'node:stream';
import * as schema from './db/schema';
import { seed } from './db/seed';
import { EmailService } from './email/email.service';
import { seedRoles } from './rbac/seed-roles';
import { SettingsService } from './settings/settings.service';

export interface CliIo {
  env: NodeJS.ProcessEnv;
  out: (line: string) => void;
  err: (line: string) => void;
  stdout?: NodeJS.WritableStream;
  stdin?: NodeJS.ReadableStream;
}

const USAGE = `Usage: cli <command>
  migrate                                   apply database migrations
  seed                                      built-in roles, default profiles, email templates
  create-admin --email <e> --name <n> [--force]
                                            create a super admin and print an activation link
  health [--mqtt-roundtrip]                 check database and Redis (and an MQTT publish round trip)
  vapid-keys                                print a new VAPID key pair for web push
  configure-smtp --host <h> --port <p> --from <addr> [--user <u> --pass <p>] [--secure]
                                            store SMTP settings (encrypted) and select the SMTP driver
  backup [--out <file>|-]                   back up now (needs the scheduler running); copy it out
  restore <file>|-                          restore a backup (maintenance mode meanwhile)
  aws-iot-setup --certs-dir <dir> [--region <r>]
                                            AWS IoT Core: endpoint, policies, ingest certificate; prints .env lines`;

function flags(args: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith('--')) continue;
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[a.slice(2)] = next;
      i++;
    } else out[a.slice(2)] = true;
  }
  return out;
}

async function withDb<T>(config: Config, fn: (db: DB) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: config.DATABASE_URL, max: 2 });
  try {
    return await fn(drizzle(pool, { schema }));
  } finally {
    await pool.end();
  }
}

async function createAdmin(config: Config, f: Record<string, string | true>, io: CliIo): Promise<number> {
  const email = typeof f.email === 'string' ? f.email.trim().toLowerCase() : '';
  const name = typeof f.name === 'string' ? f.name.trim() : '';
  if (!email.includes('@') || !name) {
    io.err('create-admin requires --email and --name');
    return 2;
  }
  return withDb(config, async (db) => {
    const roles = await seedRoles(db);
    const superRole = roles.find((r) => r.key === 'super_admin')!;
    const existing = await db.query.user.findFirst({ where: eq(schema.user.roleId, superRole.id) });
    if (existing && f.force !== true) {
      io.err(`A super admin already exists (${existing.email}). Use --force to create another.`);
      return 1;
    }
    if (await db.query.user.findFirst({ where: eq(schema.user.email, email) })) {
      io.err(`A user with email ${email} already exists.`);
      return 1;
    }
    const [created] = await db
      .insert(schema.user)
      .values({ email, name, scopeType: 'platform', roleId: superRole.id, status: 'invited' })
      .returning();
    const token = await new TokenService(db).issue(created!.id, 'invite');
    const link = `${new URL(config.PUBLIC_URL).origin}/activate?token=${token}`;
    io.out(`Super admin ${email} created. Activate within 72 hours:`);
    io.out(link);

    // Also email the link when outgoing mail is already configured.
    const settings = new SettingsService(db, config);
    if (await settings.get('email.driver')) {
      const mail = new EmailService(config, db, settings, new BrandingService(db, settings));
      try {
        await mail.deliver({ templateKey: 'user_invite', to: email, vars: { name, link }, customerId: null });
        io.out(`Activation link emailed to ${email}.`);
      } catch (e) {
        io.err(`Could not email the link: ${(e as Error).message}`);
      } finally {
        await mail.onApplicationShutdown();
      }
    }
    return 0;
  });
}

/**
 * Creates a temporary device, publishes one value over MQTT and waits for it in the latest-value
 * cache (i.e. EMQX auth → ingest → Redis all work), then removes the device again.
 */
async function mqttRoundtrip(config: Config, io: CliIo): Promise<boolean> {
  return withDb(config, async (db) => {
    const [profile] = await db
      .insert(schema.deviceProfile)
      .values({ name: `health-check-${Date.now()}` })
      .returning();
    const token = randomToken('pdt_');
    const [dev] = await db
      .insert(schema.device)
      .values({ name: 'health-check', profileId: profile!.id, credentialsHash: sha256Hex(token) })
      .returning();
    const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1 });
    const client = mqtt.connect(config.MQTT_URL, {
      clientId: dev!.id,
      username: dev!.id,
      password: token,
      reconnectPeriod: 0,
      connectTimeout: 10_000,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        client.once('connect', () => resolve());
        client.once('error', reject);
      });
      const value = Math.round(Math.random() * 1e6);
      await client.publishAsync(`perspice/v1/${dev!.id}/telemetry`, JSON.stringify({ values: { health: value } }), { qos: 1 });
      for (let i = 0; i < 40; i++) {
        const cached = await redis.hget(`latest:${dev!.id}`, 'health');
        if (cached && (JSON.parse(cached) as { v: number }).v === value) {
          io.out('mqtt roundtrip: ok');
          return true;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      io.out('mqtt roundtrip: FAILED (value not ingested within 10 s)');
      return false;
    } catch (e) {
      io.out(`mqtt roundtrip: FAILED (${(e as Error).message})`);
      return false;
    } finally {
      client.end(true);
      await db.delete(schema.device).where(eq(schema.device.id, dev!.id));
      await db.delete(schema.deviceProfile).where(eq(schema.deviceProfile.id, profile!.id));
      await redis.del(`latest:${dev!.id}`, `devmeta:${dev!.id}`, `devtok:${dev!.id}`);
      redis.disconnect();
    }
  });
}

function vapidKeys(io: CliIo): number {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' });
  const priv = privateKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x!, 'base64url'), Buffer.from(pub.y!, 'base64url')]);
  io.out(`VAPID_PUBLIC_KEY=${raw.toString('base64url')}`);
  io.out(`VAPID_PRIVATE_KEY=${priv.d}`);
  return 0;
}

async function configureSmtp(config: Config, f: Record<string, string | true>, io: CliIo): Promise<number> {
  const str = (k: string) => (typeof f[k] === 'string' ? (f[k] as string) : '');
  const port = Number(str('port') || '587');
  if (!str('host') || !str('from') || !Number.isInteger(port)) {
    io.err('configure-smtp requires --host, --from and a numeric --port');
    return 2;
  }
  await withDb(config, async (db) => {
    const settings = new SettingsService(db, config);
    await settings.set(
      'email.smtp',
      { host: str('host'), port, secure: f.secure === true || port === 465, user: str('user'), pass: str('pass'), from: str('from') },
      { secret: true },
    );
    await settings.set('email.driver', 'smtp');
  });
  io.out(`SMTP configured (${str('host')}:${port}).`);
  return 0;
}

async function health(config: Config, io: CliIo, roundtrip = false): Promise<number> {
  let ok = true;
  try {
    await withDb(config, (db) => db.execute(sql`SELECT 1`));
    io.out('database: ok');
  } catch (e) {
    ok = false;
    io.out(`database: FAILED (${(e as Error).message})`);
  }
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
  try {
    await redis.connect();
    await redis.ping();
    io.out('redis: ok');
  } catch (e) {
    ok = false;
    io.out(`redis: FAILED (${(e as Error).message})`);
  } finally {
    redis.disconnect();
  }
  if (ok && roundtrip) ok = await mqttRoundtrip(config, io);
  return ok ? 0 : 1;
}

/** Entry point shared by `node dist/cli.js` and tests. Returns the process exit code. */
export async function runCli(args: string[], io: CliIo): Promise<number> {
  const [command, ...rest] = args;
  let config: Config;
  try {
    config = loadConfig(io.env);
  } catch (e) {
    io.err((e as Error).message);
    return 2;
  }
  try {
    switch (command) {
      case 'migrate':
        await runMigrations(config.DATABASE_URL);
        io.out('Migrations applied.');
        return 0;
      case 'seed':
        await withDb(config, seed);
        io.out('Seed data applied.');
        return 0;
      case 'create-admin':
        return await createAdmin(config, flags(rest), io);
      case 'health':
        return await health(config, io, flags(rest)['mqtt-roundtrip'] === true);
      case 'vapid-keys':
        return vapidKeys(io);
      case 'configure-smtp':
        return await configureSmtp(config, flags(rest), io);
      case 'backup': {
        const out = flags(rest).out;
        return await cliBackup(config, typeof out === 'string' ? out : out === true ? '-' : undefined, { ...io, stdout: io.stdout as Writable, stdin: io.stdin as Readable });
      }
      case 'aws-iot-setup': {
        const f = flags(rest);
        if (typeof f['certs-dir'] !== 'string') {
          io.err('Usage: aws-iot-setup --certs-dir <dir> [--region <region>]');
          return 2;
        }
        await awsIotSetup({ region: typeof f.region === 'string' ? f.region : config.AWS_REGION, devicePolicy: config.AWS_IOT_POLICY_NAME, certsDir: f['certs-dir'] }, io);
        return 0;
      }
      case 'restore':
        return await cliRestore(config, rest[0], { ...io, stdout: io.stdout as Writable, stdin: io.stdin as Readable });
      default:
        io.err(USAGE);
        return 2;
    }
  } catch (e) {
    io.err(`${command} failed: ${(e as Error).message}`);
    return 1;
  }
}

if (require.main === module) {
  runCli(process.argv.slice(2), {
    env: process.env,
    out: (l) => console.log(l),
    err: (l) => console.error(l),
    stdout: process.stdout,
    stdin: process.stdin,
  }).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(e);
      process.exit(1);
    },
  );
}
