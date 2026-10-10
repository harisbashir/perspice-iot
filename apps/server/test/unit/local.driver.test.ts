import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LocalStorageDriver, verifySignedUrl } from '../../src/storage/local.driver';

const dir = mkdtempSync(join(tmpdir(), 'perspice-storage-'));
const driver = new LocalStorageDriver(dir, 'signing-secret');

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('LocalStorageDriver', () => {
  it('stores, lists, reads and deletes', async () => {
    await driver.put('branding/a/logo.png', Buffer.from('png'), 'image/png');
    expect(await driver.list('branding/')).toEqual(['branding/a/logo.png']);
    const got = await driver.get('branding/a/logo.png');
    expect(got.body.toString()).toBe('png');
    expect(got.contentType).toBe('image/png');
    await driver.delete('branding/a/logo.png');
    expect(await driver.list('branding/')).toEqual([]);
  });

  it('rejects path traversal and absolute keys', async () => {
    await expect(driver.put('../x', Buffer.from('x'), 'text/plain')).rejects.toThrow();
    await expect(driver.put('a/../../x', Buffer.from('x'), 'text/plain')).rejects.toThrow();
    await expect(driver.put('/etc/passwd', Buffer.from('x'), 'text/plain')).rejects.toThrow();
    await expect(driver.get('a\\..\\x')).rejects.toThrow();
  });

  it('signs URLs that verify until they expire', async () => {
    const url = new URL(await driver.getSignedUrl('branding/a/logo.png', 60), 'http://x');
    expect(url.pathname).toBe('/api/files/branding/a/logo.png');
    const exp = url.searchParams.get('exp')!;
    const sig = url.searchParams.get('sig')!;
    expect(verifySignedUrl('signing-secret', 'branding/a/logo.png', exp, sig)).toBe(true);
    expect(verifySignedUrl('signing-secret', 'branding/a/other.png', exp, sig)).toBe(false);
    expect(verifySignedUrl('signing-secret', 'branding/a/logo.png', '1', sig)).toBe(false);
  });
});
