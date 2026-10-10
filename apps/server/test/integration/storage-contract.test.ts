import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalStorageDriver } from '../../src/storage/local.driver';
import { S3StorageDriver } from '../../src/storage/s3.driver';
import { STORAGE, type StorageDriver } from '../../src/storage/storage.driver';
import { createTestApp } from '../harness';

const SECRET = 'x'.repeat(32);
let s3server: StartedTestContainer;
let s3: { endpoint: string; client: S3Client };

beforeAll(async () => {
  // Adobe's S3Mock: an S3-compatible server for tests (MinIO images aren't always pullable).
  s3server = await new GenericContainer('adobe/s3mock:3.12.0')
    .withExposedPorts(9090)
    .withWaitStrategy(Wait.forHttp('/favicon.ico', 9090).forStatusCodeMatching(() => true))
    .start();
  const endpoint = `http://${s3server.getHost()}:${s3server.getMappedPort(9090)}`;
  const client = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: 'perspice', secretAccessKey: 'perspice-secret' } });
  await client.send(new CreateBucketCommand({ Bucket: 'perspice' }));
  s3 = { endpoint, client };
}, 120_000);

afterAll(async () => {
  await s3server?.stop();
});

const drivers: [string, () => StorageDriver][] = [
  ['local', () => new LocalStorageDriver(mkdtempSync(join(tmpdir(), 'perspice-storage-')), SECRET)],
  [
    's3',
    () =>
      new S3StorageDriver(
        { bucket: 'perspice', region: 'us-east-1', endpoint: s3.endpoint, accessKeyId: 'perspice', secretAccessKey: 'perspice-secret', forcePathStyle: true, prefix: `t${Date.now()}${Math.random().toString(36).slice(2, 6)}/` },
        SECRET,
      ),
  ],
];

const text = async (r: Readable) => {
  const chunks: Buffer[] = [];
  for await (const c of r) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString();
};

describe.each(drivers)('storage contract: %s', (_name, make) => {
  it('puts, gets, streams, lists, moves and deletes objects', async () => {
    const d = make();
    await d.put('assets/logo.svg', Buffer.from('<svg/>'), 'image/svg+xml');
    expect(await d.get('assets/logo.svg')).toEqual({ body: Buffer.from('<svg/>'), contentType: 'image/svg+xml' });

    const big = 'x'.repeat(6 * 1024 * 1024 + 123); // over one multipart part
    await d.putStream('exports/u/1/big.csv', Readable.from([big.slice(0, 3_000_000), big.slice(3_000_000)]), 'text/csv');
    const s = await d.getStream('exports/u/1/big.csv');
    expect(s).toMatchObject({ contentType: 'text/csv', size: big.length });
    expect((await text(s.body)).length).toBe(big.length);

    await d.put('backups/a.tmp', Buffer.from('backup'), 'application/octet-stream');
    await d.move('backups/a.tmp', 'backups/latest.pbk');
    expect((await d.get('backups/latest.pbk')).body.toString()).toBe('backup');
    await expect(d.get('backups/a.tmp')).rejects.toThrow();

    expect(await d.list('')).toEqual(['assets/logo.svg', 'backups/latest.pbk', 'exports/u/1/big.csv']);
    expect(await d.list('exports/')).toEqual(['exports/u/1/big.csv']);
    await d.delete('exports/u/1/big.csv');
    await d.delete('exports/u/1/big.csv'); // deleting twice is fine
    expect(await d.list('exports/')).toEqual([]);
  });

  it('signs download links that expire', async () => {
    const d = make();
    await d.put('exports/u/2/report.pdf', Buffer.from('%PDF-'), 'application/pdf');
    const url = await d.getSignedUrl('exports/u/2/report.pdf', 60);
    expect(url).toMatch(/^\/api\/files\/exports\/u\/2\/report\.pdf\?exp=\d+&sig=/);
    await expect(() => d.put('../escape', Buffer.from('x'), 'text/plain')).rejects.toThrow(/Invalid storage key/);
  });
});

describe('the app on S3 storage', () => {
  it('serves stored files through signed /api/files links', async () => {
    const t = await createTestApp({
      overrides: { STORAGE_DRIVER: 's3', S3_BUCKET: 'perspice', S3_ENDPOINT: s3.endpoint, S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 'b', S3_FORCE_PATH_STYLE: 'true' },
    });
    try {
      const storage = t.app.get<StorageDriver>(STORAGE);
      expect(storage).toBeInstanceOf(S3StorageDriver);
      await storage.put('exports/u/3/data.csv', Buffer.from('a,b\n1,2\n'), 'text/csv');
      const res = await t.http.get(await storage.getSignedUrl('exports/u/3/data.csv', 60));
      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toBe('attachment; filename="data.csv"');
      expect(res.text).toBe('a,b\n1,2\n');
      expect((await t.http.get('/api/files/exports/u/3/data.csv?exp=1&sig=x')).status).toBe(404);
    } finally {
      await t.close();
    }
  });
});
