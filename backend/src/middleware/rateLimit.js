const rateLimit = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");
const { connection } = require("../services/queue");

/**
 * Per-user (falls back to per-IP) rate limiting backed by Redis so limits
 * are enforced consistently across horizontally-scaled API replicas
 * (see docker-compose `api` service scaling).
 */
function makeLimiter({ windowMs, max, name }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || req.ip,
    store: new RedisStore({
      sendCommand: (...args) => connection.call(...args),
      prefix: `rl:${name}:`,
    }),
    message: { error: `Rate limit exceeded for ${name}. Try again shortly.` },
  });
}

const searchLimiter = makeLimiter({ windowMs: 60 * 1000, max: 100, name: "search" });
const uploadLimiter = makeLimiter({ windowMs: 60 * 1000, max: 20, name: "upload" });
const authLimiter = makeLimiter({ windowMs: 60 * 1000, max: 10, name: "auth" });
// Separate, generous limiter for status polling (upload page polls every
// ~1.2s while the async fingerprint job runs) — this must NOT share a
// budget with the upload endpoint itself, or normal polling gets
// rate-limited as if it were abuse.
const pollLimiter = makeLimiter({ windowMs: 60 * 1000, max: 300, name: "poll" });

module.exports = { searchLimiter, uploadLimiter, authLimiter, pollLimiter };
