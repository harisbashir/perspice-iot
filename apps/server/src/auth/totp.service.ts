import { Inject, Injectable } from '@nestjs/common';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { decryptSecret, encryptSecret } from '../common/crypto';
import { CONFIG, type Config } from '../config/config';

@Injectable()
export class TotpService {
  constructor(@Inject(CONFIG) private readonly config: Config) {}

  generate(issuer: string, account: string): { secret: string; otpauthUrl: string; encrypted: string } {
    const secret = generateSecret();
    return {
      secret,
      otpauthUrl: generateURI({ issuer, label: account, secret }),
      encrypted: encryptSecret(secret, this.config.masterKey),
    };
  }

  /** Accepts the current code and the adjacent 30 s steps to tolerate clock drift. */
  verify(encryptedSecret: string | null, code: string | undefined): boolean {
    if (!encryptedSecret || !code || !/^\d{6}$/.test(code)) return false;
    const secret = decryptSecret(encryptedSecret, this.config.masterKey);
    return verifySync({ secret, token: code, epochTolerance: 30 }).valid;
  }
}
