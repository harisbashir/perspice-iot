import { describe, expect, it } from 'vitest';
import {
  BulkRequestSchema,
  ClaimRequestSchema,
  FirmwareUploadSchema,
  ImportRowSchema,
  OtaJobInputSchema,
  OtaProgressSchema,
  isClaimCode,
  normalizeClaimCode,
  parseCsv,
  toCsv,
} from '../src/index.js';

const U = '11111111-1111-4111-8111-111111111111';

describe('CSV', () => {
  it('parses quotes, escaped quotes, commas and newlines in fields, CRLF and a BOM', () => {
    const text = '﻿name,tags,notes\r\n"Van, 7",a;b,"said ""hi""\nthen left"\r\nTower 2,,\r\n';
    expect(parseCsv(text)).toEqual([
      ['name', 'tags', 'notes'],
      ['Van, 7', 'a;b', 'said "hi"\nthen left'],
      ['Tower 2', '', ''],
    ]);
  });

  it('ignores a trailing empty line and keeps empty fields', () => {
    expect(parseCsv('a,b\n1,\n')).toEqual([['a', 'b'], ['1', '']]);
  });

  it('writes CSV that parses back, quoting only when needed and neutralising formulas', () => {
    const rows = [['id', 'name'], ['1', 'Van, 7'], ['2', 'say "hi"'], ['3', '=HYPERLINK("x")']];
    const text = toCsv(rows);
    expect(text).toBe('id,name\r\n1,"Van, 7"\r\n2,"say ""hi"""\r\n3,"\'=HYPERLINK(""x"")"\r\n');
    expect(parseCsv(text)[1]).toEqual(['1', 'Van, 7']);
  });
});

describe('claim codes', () => {
  it('normalises case, spaces and dashes, and checks the alphabet', () => {
    expect(normalizeClaimCode(' abcd-efgh-jkmn ')).toBe('ABCDEFGHJKMN');
    expect(isClaimCode('ABCDEFGHJKMN')).toBe(true);
    expect(isClaimCode('ABCDEFGHJKM0')).toBe(false); // no 0
    expect(isClaimCode('ABCDEFGHJKM')).toBe(false); // too short
    expect(ClaimRequestSchema.parse({ code: 'abcd efgh jkmn' }).code).toBe('ABCDEFGHJKMN');
  });
});

describe('fleet schemas', () => {
  it('firmware uploads need a profile and a version', () => {
    expect(FirmwareUploadSchema.parse({ profileId: U, version: '1.3.0' })).toMatchObject({ version: '1.3.0', notes: '' });
    expect(FirmwareUploadSchema.safeParse({ profileId: U, version: 'has space' }).success).toBe(false);
  });

  it('OTA jobs default to batches of 10, halting above 20% failures, 30 minute timeouts', () => {
    const job = OtaJobInputSchema.parse({ firmwareId: U, target: { kind: 'profile' } });
    expect(job).toMatchObject({ batchSize: 10, maxFailurePct: 20, timeoutMin: 30 });
    expect(OtaJobInputSchema.safeParse({ firmwareId: U, target: { kind: 'devices', deviceIds: [] } }).success).toBe(false);
  });

  it('progress messages from devices', () => {
    expect(OtaProgressSchema.parse({ version: '1.3.0', state: 'downloading', pct: 42 })).toEqual({ version: '1.3.0', state: 'downloading', pct: 42 });
    expect(OtaProgressSchema.safeParse({ version: '1.3.0', state: 'exploded' }).success).toBe(false);
  });

  it('import rows: tags split on semicolons, claim yes/no, location both or neither', () => {
    expect(ImportRowSchema.parse({ name: 'Van 7', profile: 'Tracker', tags: 'a; b;', claim: 'yes', lat: '51.5', lng: '-0.1' })).toMatchObject({
      name: 'Van 7',
      tags: ['a', 'b'],
      claim: true,
      lat: 51.5,
      lng: -0.1,
    });
    expect(ImportRowSchema.safeParse({ name: 'Van', profile: 'Tracker', lat: '51.5' }).success).toBe(false);
    expect(ImportRowSchema.safeParse({ name: '', profile: 'Tracker' }).success).toBe(false);
  });

  it('bulk requests: up to 500 devices, one action', () => {
    expect(BulkRequestSchema.parse({ deviceIds: [U], action: { kind: 'tags', add: ['x'], remove: [] } })).toBeTruthy();
    expect(BulkRequestSchema.safeParse({ deviceIds: Array(501).fill(U), action: { kind: 'delete' } }).success).toBe(false);
    expect(BulkRequestSchema.safeParse({ deviceIds: [U], action: { kind: 'explode' } }).success).toBe(false);
  });
});
