import * as argon2 from 'argon2';
import { validation } from '../common/app-error';

export const MIN_PASSWORD_LENGTH = 10;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function assertPasswordPolicy(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw validation(
      [{ path: ['password'], message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }],
      'Password too short',
    );
  }
}

let dummyHash: Promise<string> | undefined;

/** Burns the same time as a real verification so unknown emails cannot be detected by timing. */
export async function verifyDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  await verifyPassword(await dummyHash, password);
  return false;
}
