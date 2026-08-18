const Minio = require("minio");
const fs = require("fs");
const path = require("path");

const LOCAL_STORAGE_DIR = path.join(__dirname, "../../../data/uploads");

let client = null;
let useLocal = false;

try {
  if (process.env.MINIO_ENDPOINT) {
    client = new Minio.Client({
      endPoint: process.env.MINIO_ENDPOINT,
      port: parseInt(process.env.MINIO_PORT || "9000", 10),
      useSSL: process.env.MINIO_USE_SSL === "true",
      accessKey: process.env.MINIO_ACCESS_KEY || "ddas_admin",
      secretKey: process.env.MINIO_SECRET_KEY || "ddas_dev_password",
    });
  }
} catch (e) {
  useLocal = true;
}

const BUCKET = process.env.MINIO_BUCKET || "ddas-datasets";

async function ensureBucket() {
  if (!fs.existsSync(LOCAL_STORAGE_DIR)) {
    fs.mkdirSync(LOCAL_STORAGE_DIR, { recursive: true });
  }

  if (client) {
    try {
      const exists = await client.bucketExists(BUCKET).catch(() => false);
      if (!exists) {
        await client.makeBucket(BUCKET);
        console.log(`[storage] created MinIO bucket "${BUCKET}"`);
      } else {
        console.log(`[storage] connected to MinIO (bucket "${BUCKET}" ready)`);
      }
      return;
    } catch (err) {
      console.warn(`[storage] MinIO unavailable (${err.message}), using local storage directory:`, LOCAL_STORAGE_DIR);
      useLocal = true;
    }
  } else {
    useLocal = true;
  }
}

/**
 * Stores an (already encrypted) buffer under an opaque key.
 */
async function putObject(key, buffer) {
  if (!useLocal && client) {
    try {
      await client.putObject(BUCKET, key, buffer);
      return key;
    } catch (err) {
      console.warn("[storage] MinIO putObject failed, falling back to local file:", err.message);
      useLocal = true;
    }
  }

  const filePath = path.join(LOCAL_STORAGE_DIR, key);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    await fs.promises.mkdir(dir, { recursive: true });
  }
  await fs.promises.writeFile(filePath, buffer);
  return key;

}

async function getObject(key) {
  if (!useLocal && client) {
    try {
      const stream = await client.getObject(BUCKET, key);
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      return Buffer.concat(chunks);
    } catch (err) {
      useLocal = true;
    }
  }

  const filePath = path.join(LOCAL_STORAGE_DIR, key);
  return await fs.promises.readFile(filePath);
}

async function deleteObject(key) {
  if (!useLocal && client) {
    try {
      await client.removeObject(BUCKET, key);
      return;
    } catch {}
  }

  const filePath = path.join(LOCAL_STORAGE_DIR, key);
  if (fs.existsSync(filePath)) {
    await fs.promises.unlink(filePath);
  }
}

module.exports = { client, ensureBucket, putObject, getObject, deleteObject, BUCKET };

