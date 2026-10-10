import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, randomToken, sha256Hex } from '../../src/common/crypto';

const key = randomBytes(32);

describe('crypto', () => {
  it('round-trips a secret', () => {
    const blob = encryptSecret('hunter2', key);
    expect(blob).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
    expect(blob).not.toContain('hunter2');
    expect(decryptSecret(blob, key)).toBe('hunter2');
  });

  it('uses a fresh IV for every encryption', () => {
    expect(encryptSecret('x', key)).not.toBe(encryptSecret('x', key));
  });

  it('detects tampering with the ciphertext', () => {
    const [v, iv, tag, ct] = encryptSecret('hunter2', key).split(':');
    const bytes = Buffer.from(ct!, 'base64');
    bytes[0] = bytes[0]! ^ 0xff;
    expect(() => decryptSecret([v, iv, tag, bytes.toString('base64')].join(':'), key)).toThrow();
  });

  it('rejects the wrong key', () => {
    expect(() => decryptSecret(encryptSecret('x', key), randomBytes(32))).toThrow();
  });

  it('generates prefixed base64url tokens', () => {
    const token = randomToken('pdt_');
    expect(token).toMatch(/^pdt_[A-Za-z0-9_-]{43}$/);
  });

  it('hashes with sha256 hex', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
