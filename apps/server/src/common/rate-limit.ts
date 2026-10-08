import type Redis from 'ioredis';

/** Fixed-window counter: at most `limit` hits per `windowS` seconds for `key`. */
export async function rateLimit(
  redis: Redis,
  key: string,
  limit: number,
  windowS: number,
): Promise<{ allowed: boolean; retryAfterS: number }> {
  const now = Date.now();
  const window = Math.floor(now / (windowS * 1000));
  const redisKey = `rl:${key}:${window}`;
  const [[, count]] = (await redis.multi().incr(redisKey).expire(redisKey, windowS + 1).exec()) as [
    [Error | null, number],
    [Error | null, number],
  ];
  const retryAfterS = Math.max(1, Math.ceil(((window + 1) * windowS * 1000 - now) / 1000));
  return { allowed: count <= limit, retryAfterS };
}
