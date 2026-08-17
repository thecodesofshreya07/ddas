const { Queue } = require("bullmq");
const IORedis = require("ioredis");

// BullMQ stands in for Kafka in this build: same purpose (decouple the fast
// upload response from expensive async processing), far less operational
// overhead for a 5-day build. The job payload/handler shape below ports
// directly to a Kafka consumer if this ever needs to scale further.
const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

const fingerprintQueue = new Queue("fingerprint", { connection });

/**
 * Enqueues a newly-uploaded file for async processing:
 * structural fingerprinting, similarity scoring, search indexing.
 * The API returns immediately after this — the user isn't blocked on
 * a potentially slow analysis pipeline.
 */
async function enqueueFingerprintJob(payload) {
  return fingerprintQueue.add("fingerprint-file", payload, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: false, // keep failures visible for debugging/demo
  });
}

module.exports = { connection, fingerprintQueue, enqueueFingerprintJob };
