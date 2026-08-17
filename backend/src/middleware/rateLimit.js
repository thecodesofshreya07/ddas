const rateLimit = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");
const { connection } = require("../services/queue");

function makeLimiter({ windowMs, max, name }) {
  const options = {
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || req.ip,
    message: { error: `Rate limit exceeded for ${name}. Try again shortly.` },
  };

  if (connection && connection.status === "ready") {
    try {
      options.store = new RedisStore({
        sendCommand: (...args) => connection.call(...args),
        prefix: `rl:${name}:`,
      });
    } catch {
      // Memory store fallback
    }
  }

  return rateLimit(options);
}

const searchLimiter = makeLimiter({ windowMs: 60 * 1000, max: 100, name: "search" });
const uploadLimiter = makeLimiter({ windowMs: 60 * 1000, max: 20, name: "upload" });
const authLimiter = makeLimiter({ windowMs: 60 * 1000, max: 10, name: "auth" });
const pollLimiter = makeLimiter({ windowMs: 60 * 1000, max: 300, name: "poll" });

module.exports = { searchLimiter, uploadLimiter, authLimiter, pollLimiter };

