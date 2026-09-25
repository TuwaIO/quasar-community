import { redis } from './redis';

/**
 * Validates if an identifier (IP or User ID) has exceeded the rate limit.
 * Uses a basic fixed-window algorithm with Redis.
 *
 * Default: 5 requests / 1 second (Global API limit)
 *
 * @param identifier Unique key (IP, user ID, etc.)
 * @param limit Max requests per window
 * @param windowSeconds Window duration in seconds
 * @param prefix Redis key prefix
 * @returns boolean - true if rate limited, false otherwise
 */
export async function isRateLimited(
  identifier: string,
  limit = 5,
  windowSeconds = 1,
  prefix = 'ratelimit:global',
): Promise<boolean> {
  const key = `${prefix}:${identifier}`;

  try {
    // Atomic increment
    const current = await redis.incr(key);

    // Set expiration on first request in the window
    if (current === 1) {
      await redis.expire(key, windowSeconds);
    }

    // Return true if the limit is exceeded
    return current > limit;
  } catch (error) {
    console.error('[RateLimit] Redis error:', (error as Error).message);
    // In development mode, fail-open to prevent blocking local dev workflow when Redis is restarting.
    // In production mode, fail-closed to protect downstream services from DDoS.
    if (process.env.NODE_ENV === 'development') {
      return false;
    }
    return true;
  }
}
