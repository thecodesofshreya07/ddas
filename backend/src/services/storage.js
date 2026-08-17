const Minio = require("minio");

const client = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT,
  port: parseInt(process.env.MINIO_PORT, 10),
  useSSL: process.env.MINIO_USE_SSL === "true",
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY,
});

const BUCKET = process.env.MINIO_BUCKET;

async function ensureBucket() {
  const exists = await client.bucketExists(BUCKET).catch(() => false);
  if (!exists) {
    await client.makeBucket(BUCKET);
    console.log(`[storage] created bucket "${BUCKET}"`);
  }
}

/**
 * Stores an (already encrypted) buffer under an opaque key.
 * Never derive storage keys from user-supplied filenames — that's how path
 * traversal / IDOR-style leaks happen. Use the dataset_version UUID instead.
 */
async function putObject(key, buffer) {
  await client.putObject(BUCKET, key, buffer);
  return key;
}

async function getObject(key) {
  const stream = await client.getObject(BUCKET, key);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function deleteObject(key) {
  await client.removeObject(BUCKET, key);
}

module.exports = { client, ensureBucket, putObject, getObject, deleteObject, BUCKET };
