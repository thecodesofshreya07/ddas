const { Queue } = require("bullmq");
const IORedis = require("ioredis");

let connection = null;
let fingerprintQueue = null;
let useLocalQueue = false;

try {
  if (process.env.REDIS_URL) {
    connection = new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      lazyConnect: true,
      retryStrategy: () => null, // Don't hang on connection fail
    });
    connection.on("error", () => {
      useLocalQueue = true;
    });
    connection.connect().catch(() => {
      useLocalQueue = true;
    });
    fingerprintQueue = new Queue("fingerprint", { connection });
  } else {
    useLocalQueue = true;
  }
} catch {
  useLocalQueue = true;
}

/**
 * Enqueues a newly-uploaded file for async processing.
 * Falls back to in-process execution if Redis is not running.
 */
async function enqueueFingerprintJob(payload) {
  if (!useLocalQueue && fingerprintQueue) {
    try {
      return await fingerprintQueue.add("fingerprint-file", payload, {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: false,
      });
    } catch {
      useLocalQueue = true;
    }
  }

  // Local in-memory asynchronous worker fallback
  setImmediate(async () => {
    try {
      const { processFingerprintJob } = require("./fingerprintJobRunner");
      await processFingerprintJob(payload);
    } catch (err) {
      console.warn("[queue:local] error executing fingerprint job:", err.message);
    }
  });

  return { id: `local-${Date.now()}` };
}

module.exports = { connection, fingerprintQueue, enqueueFingerprintJob };

