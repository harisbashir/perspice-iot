import 'reflect-metadata';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { TokenService } from './auth/token.service';
import { BrandingService } from './branding/branding.service';
import { type Config, loadConfig } from './config/config';
import type { DB } from './db/db.module';
import { runMigrations } from './db/migrate';
import * as schema from './db/schema';
import { seed } from './db/seed';
import { EmailService } from './email/email.service';
import { seedRoles } from './rbac/seed-roles';
import { SettingsService } from './settings/settings.service';

export interface CliIo {
  env: NodeJS.ProcessEnv;
  out: (line: string) => void;
  err: (line: string) => void;
}

const USAGE = `Usage: cli <command>
  migrate                                   apply database migrations
  seed                                      built-in roles, default profiles, email templates
  create-admin --email <e> --name <n> [--force]
                                            create a super admin and print an activation link
  health                                    check database and Redis connectivity`;

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

async function health(config: Config, io: CliIo): Promise<number> {
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
        return await health(config, io);
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
  }).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(e);
      process.exit(1);
    },
  );
}
