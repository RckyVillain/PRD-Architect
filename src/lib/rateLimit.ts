// Simple In-Memory Client IP Rate Limiter

const tracker = new Map<string, { count: number; resetTime: number }>();

/**
 * Checks if a client IP has exceeded the rate limit.
 * Defaults to 15 requests per 60 seconds.
 * 
 * @param ip Client IP Address
 * @param limit Max allowed requests within the window
 * @param windowMs Time window in milliseconds
 * @returns boolean true if the client is rate-limited, false otherwise
 */
export function isRateLimited(ip: string, limit = 15, windowMs = 60 * 1000): boolean {
  const now = Date.now();
  const record = tracker.get(ip);

  if (!record) {
    tracker.set(ip, { count: 1, resetTime: now + windowMs });
    return false;
  }

  // If the window has expired, reset count and window
  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + windowMs;
    return false;
  }

  record.count += 1;
  return record.count > limit;
}
