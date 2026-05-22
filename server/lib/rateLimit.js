// Tiny in-memory rate limiter. Single-process is fine for the current
// single-server SQLite deployment; revisit if we ever scale horizontally.
const buckets = new Map();

function rateLimit({ key, limit, windowMs }) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.start > windowMs) {
    buckets.set(key, { start: now, count: 1 });
    return { allowed: true, remaining: limit - 1 };
  }
  if (bucket.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterMs: bucket.start + windowMs - now };
  }
  bucket.count += 1;
  return { allowed: true, remaining: limit - bucket.count };
}

// Periodic GC so the Map can't grow without bound. 5-minute sweep is fine.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now - b.start > 60 * 60 * 1000) buckets.delete(k);
  }
}, 5 * 60 * 1000).unref();

module.exports = { rateLimit };
