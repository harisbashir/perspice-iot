import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/config';

const validEnv = (): NodeJS.ProcessEnv => ({
  DATABASE_URL: 'postgres://u:p@localhost:5432/perspice',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(32),
  MASTER_KEY: randomBytes(32).toString('base64'),
  INTERNAL_SECRET: 'internal-secret',
});

describe('loadConfig', () => {
  it('accepts a valid environment and applies defaults', () => {
    const config = loadConfig(validEnv());
    expect(config.PERSPICE_ROLE).toBe('all');
    expect(config.PORT).toBe(3000);
    expect(config.MQTT_INGEST_USERNAME).toBe('perspice-ingest');
    expect(config.STORAGE_DRIVER).toBe('local');
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.masterKey).toHaveLength(32);
  });

  it('rejects a missing DATABASE_URL', () => {
    const env = validEnv();
    delete env.DATABASE_URL;
    expect(() => loadConfig(env)).toThrow(/DATABASE_URL/);
  });

  it('rejects a MASTER_KEY that is not 32 bytes', () => {
    expect(() => loadConfig({ ...validEnv(), MASTER_KEY: randomBytes(16).toString('base64') })).toThrow(
      /MASTER_KEY/,
    );
  });

  it('rejects a short JWT_SECRET', () => {
    expect(() => loadConfig({ ...validEnv(), JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('rejects an unknown role', () => {
    expect(() => loadConfig({ ...validEnv(), PERSPICE_ROLE: 'worker' })).toThrow(/PERSPICE_ROLE/);
  });
});
