const crypto = require("crypto");
const { Transform } = require("stream");

/**
 * Streams a file through SHA-256 without ever holding the whole file in
 * memory — this is what lets fingerprinting scale to large files (the doc's
 * "streaming hash" optimization). Returns { hash, sizeBytes }.
 */
function hashStream(readStream) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    let sizeBytes = 0;

    readStream.on("data", (chunk) => {
      hash.update(chunk);
      sizeBytes += chunk.length;
    });
    readStream.on("end", () => {
      resolve({ hash: hash.digest("hex"), sizeBytes });
    });
    readStream.on("error", reject);
  });
}

/**
 * A Transform stream that hashes data as it passes through, so upload,
 * hashing, and writing to object storage can all happen in a single pass
 * instead of reading the file multiple times.
 */
function createHashingPassthrough() {
  const hash = crypto.createHash("sha256");
  let sizeBytes = 0;

  const transform = new Transform({
    transform(chunk, _enc, callback) {
      hash.update(chunk);
      sizeBytes += chunk.length;
      callback(null, chunk);
    },
  });

  transform.getResult = () => ({ hash: hash.digest("hex"), sizeBytes });
  return transform;
}

const ALGO = "aes-256-gcm";

function getKey() {
  const keyHex = process.env.FILE_ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    throw new Error(
      "FILE_ENCRYPTION_KEY must be a 64-char hex string (32 bytes). See .env.example."
    );
  }
  return Buffer.from(keyHex, "hex");
}

/**
 * Encrypts a buffer with AES-256-GCM. Returns iv + authTag + ciphertext
 * concatenated so the file can be stored as a single opaque object.
 */
function encryptBuffer(buffer) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

function decryptBuffer(payload) {
  const key = getKey();
  const iv = payload.subarray(0, 12);
  const authTag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

module.exports = {
  hashStream,
  createHashingPassthrough,
  encryptBuffer,
  decryptBuffer,
};
