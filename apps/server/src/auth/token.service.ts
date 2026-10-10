import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode } from '@perspice/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { randomToken, sha256Hex } from '../common/crypto';
import { DB } from '../db/db.module';
import { userToken } from '../db/schema';

export type UserTokenType = 'invite' | 'reset';

export const TOKEN_TTL_MS: Record<UserTokenType, number> = {
  invite: 72 * 60 * 60 * 1000,
  reset: 60 * 60 * 1000,
};

export const tokenInvalid = () =>
  new AppError(ErrorCode.TOKEN_INVALID, 'This link is invalid or has expired', 400);

@Injectable()
export class TokenService {
  constructor(@Inject(DB) private readonly db: DB) {}

  /** Issues a single-use token; earlier unused tokens of the same type stop working. */
  async issue(userId: string, type: UserTokenType): Promise<string> {
    const token = randomToken('');
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .update(userToken)
        .set({ usedAt: now })
        .where(and(eq(userToken.userId, userId), eq(userToken.type, type), isNull(userToken.usedAt)));
      await tx.insert(userToken).values({
        userId,
        type,
        tokenHash: sha256Hex(token),
        expiresAt: new Date(now.getTime() + TOKEN_TTL_MS[type]),
      });
    });
    return token;
  }

  /** Returns the user id without consuming the token (for validating input first). */
  async peek(token: string, type: UserTokenType): Promise<string> {
    const row = await this.db.query.userToken.findFirst({
      where: and(eq(userToken.tokenHash, sha256Hex(token)), eq(userToken.type, type), isNull(userToken.usedAt)),
    });
    if (!row || row.expiresAt.getTime() <= Date.now()) throw tokenInvalid();
    return row.userId;
  }

  async consume(token: string, type: UserTokenType): Promise<string> {
    const userId = await this.peek(token, type);
    const [row] = await this.db
      .update(userToken)
      .set({ usedAt: new Date() })
      .where(and(eq(userToken.tokenHash, sha256Hex(token)), eq(userToken.type, type), isNull(userToken.usedAt)))
      .returning({ userId: userToken.userId });
    if (!row) throw tokenInvalid();
    return userId;
  }
}
