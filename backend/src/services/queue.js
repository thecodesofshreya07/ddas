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

async function enqueueFingerprintJob(payload) {
  // Always trigger the background fingerprint job runner immediately
  setImmediate(async () => {
    try {
      const { processFingerprintJob } = require("./fingerprintJobRunner");
      await processFingerprintJob(payload);
    } catch (err) {
      console.warn("[queue] error executing fingerprint job:", err.message);
    }
  });

  if (!useLocalQueue && fingerprintQueue) {
    try {
      await fingerprintQueue.add("fingerprint-file", payload, {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: false,
      }).catch(() => {});
    } catch {}
  }

  return { id: `job-${Date.now()}` };
}

module.exports = { connection, fingerprintQueue, enqueueFingerprintJob };

