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

describe('operations configuration', () => {
  it('requires a bucket for S3 storage', () => {
    expect(() => loadConfig({ ...validEnv(), STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET/);
    const c = loadConfig({ ...validEnv(), STORAGE_DRIVER: 's3', S3_BUCKET: 'perspice', S3_ENDPOINT: 'http://minio:9000', S3_FORCE_PATH_STYLE: 'true' });
    expect(c).toMatchObject({ STORAGE_DRIVER: 's3', S3_BUCKET: 'perspice', S3_REGION: 'us-east-1', S3_FORCE_PATH_STYLE: true });
  });

  it('requires an endpoint and certificates for AWS IoT Core', () => {
    expect(() => loadConfig({ ...validEnv(), MQTT_TRANSPORT: 'aws-iot' })).toThrow(/AWS_IOT_ENDPOINT/);
    const c = loadConfig({
      ...validEnv(),
      MQTT_TRANSPORT: 'aws-iot',
      AWS_IOT_ENDPOINT: 'abc-ats.iot.eu-west-1.amazonaws.com',
      AWS_REGION: 'eu-west-1',
      AWS_IOT_CERT_PATH: '/certs/ingest.pem',
      AWS_IOT_KEY_PATH: '/certs/ingest.key',
      AWS_IOT_CA_PATH: '/certs/root-ca.pem',
    });
    expect(c).toMatchObject({ MQTT_TRANSPORT: 'aws-iot', AWS_IOT_POLICY_NAME: 'perspice-device' });
  });

  it('defaults backups to no master key and the PATH tools; a short passphrase is refused', () => {
    const c = loadConfig(validEnv());
    expect(c).toMatchObject({ BACKUP_INCLUDE_MASTER_KEY: false, PG_DUMP_PATH: 'pg_dump', PG_RESTORE_PATH: 'pg_restore', MQTT_TRANSPORT: 'emqx', METRICS_ENABLED: true });
    expect(() => loadConfig({ ...validEnv(), BACKUP_PASSPHRASE: 'short' })).toThrow(/BACKUP_PASSPHRASE/);
  });

  it('treats empty values (unset compose variables) as unset', () => {
    const c = loadConfig({ ...validEnv(), BACKUP_PASSPHRASE: '', S3_ENDPOINT: '', S3_BUCKET: '' });
    expect(c.BACKUP_PASSPHRASE).toBeUndefined();
    expect(c.S3_ENDPOINT).toBeUndefined();
  });
});
