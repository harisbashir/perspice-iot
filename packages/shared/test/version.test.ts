import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('VERSION', () => {
  it('is a valid semantic version', () => {
    const version = readFileSync(resolve(__dirname, '../../../VERSION'), 'utf8').trim();
    expect(version).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
  });
});
