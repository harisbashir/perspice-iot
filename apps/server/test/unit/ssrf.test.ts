import { describe, expect, it } from 'vitest';
import { assertSafeUrl, isPrivateAddress } from '../../src/delivery/ssrf';

const strict = { allowHttp: false, allowPrivate: false };

describe('SSRF guard (Review Focus 3)', () => {
  it('classifies addresses', () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '172.20.0.5', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '224.0.0.1', 'not-an-ip']) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
    for (const a of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) expect(isPrivateAddress(a), a).toBe(false);
  });

  it('refuses unsafe URLs', async () => {
    await expect(assertSafeUrl('http://hooks.example.com', strict)).rejects.toThrow('Use an https URL');
    await expect(assertSafeUrl('https://127.0.0.1/x', strict)).rejects.toThrow(/private/);
    await expect(assertSafeUrl('https://[::1]/x', strict)).rejects.toThrow(/private/);
    await expect(assertSafeUrl('https://169.254.169.254/latest/meta-data', strict)).rejects.toThrow(/private/);
    await expect(assertSafeUrl('https://localhost/x', strict)).rejects.toThrow(/private/);
    await expect(assertSafeUrl('https://user:pw@8.8.8.8/x', strict)).rejects.toThrow(/credentials/);
    await expect(assertSafeUrl('ftp://8.8.8.8', { ...strict, allowHttp: true })).rejects.toThrow(/http\(s\)/);
  });

  it('accepts public destinations, and private ones only when allowed', async () => {
    await expect(assertSafeUrl('https://8.8.8.8/hook', strict)).resolves.toBeInstanceOf(URL);
    await expect(assertSafeUrl('http://127.0.0.1:9000/x', { allowHttp: true, allowPrivate: true })).resolves.toBeInstanceOf(URL);
  });
});
