import { describe, expect, it } from 'vitest';
import { BackupScheduleSchema, isCompatibleBackup } from '../src/index.js';

describe('operations contracts', () => {
  it('defaults the backup schedule to daily at 02:00 UTC', () => {
    expect(BackupScheduleSchema.parse({})).toEqual({ enabled: true, time: '02:00', timezone: 'UTC' });
    expect(BackupScheduleSchema.safeParse({ time: '2am' }).success).toBe(false);
  });

  it('accepts backups that are not newer, back to the oldest release the migrations start from', () => {
    expect(isCompatibleBackup('0.4.0', '0.4.0')).toEqual({ ok: true, migrate: false });
    expect(isCompatibleBackup('0.3.2', '0.4.0')).toEqual({ ok: true, migrate: true });
    expect(isCompatibleBackup('0.5.0', '0.4.0')).toMatchObject({ ok: false, reason: expect.stringMatching(/newer/) });
    expect(isCompatibleBackup('1.0.0', '0.4.0')).toMatchObject({ ok: false, reason: expect.stringMatching(/newer/) });
    // 1.0 is a release, not a schema break: 0.x backups migrate forward.
    expect(isCompatibleBackup('0.1.0', '1.0.0')).toEqual({ ok: true, migrate: true });
    expect(isCompatibleBackup('0.8.0', '1.0.0-rc.1')).toEqual({ ok: true, migrate: true });
    expect(isCompatibleBackup('0.0.9', '1.0.0')).toMatchObject({ ok: false, reason: expect.stringMatching(/older than/) });
    expect(isCompatibleBackup('0.4.1', '0.4.0')).toMatchObject({ ok: false });
    expect(isCompatibleBackup('dev', '0.4.0')).toMatchObject({ ok: false });
    // The same build restores its own backups, whatever its version string.
    expect(isCompatibleBackup('e2e', 'e2e')).toEqual({ ok: true, migrate: false });
    expect(isCompatibleBackup('e2e', '0.4.0')).toMatchObject({ ok: false });
  });
});
