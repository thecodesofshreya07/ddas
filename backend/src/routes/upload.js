const express = require("express");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { uploadLimiter, pollLimiter } = require("../middleware/rateLimit");
const { hashStream } = require("../services/crypto");
const { encryptBuffer } = require("../services/crypto");
const { putObject } = require("../services/storage");
const { findExactDuplicate } = require("../services/duplicateEngine");
const { enqueueFingerprintJob } = require("../services/queue");
const { recordEvent } = require("../services/auditLog");
const { matchesSignature } = require("../services/fileSignature");

const router = express.Router();

// In-memory buffering is fine at hackathon file sizes; for large files this
// is exactly where the doc's "streaming through to storage" optimization
// would replace multer's memory storage with a disk/stream-based approach.
const ALLOWED_MIME = new Set([
  "text/csv",
  "application/vnd.ms-excel",
  "application/json",
  "application/pdf",
  "image/png",
  "image/jpeg",
]);
const MAX_SIZE_BYTES = 200 * 1024 * 1024; // 200MB demo cap

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
    cb(null, true);
  },
});

function inferFormat(mimetype, filename) {
  if (mimetype === "text/csv" || filename.endsWith(".csv")) return "csv";
  if (mimetype === "application/json") return "json";
  if (mimetype === "application/pdf") return "pdf";
  if (mimetype.startsWith("image/")) return "image";
  return "other";
}

/**
 * POST /api/upload
 * multipart/form-data: file, title, description, domain, period_start,
 * period_end, spatial_min_lat/max_lat/min_lng/max_lng, spatial_region_name,
 * classification, existingDatasetId (optional, to add a new version to an
 * existing dataset instead of creating a new one)
 */
router.post("/", requireAuth, uploadLimiter, upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const {
    title,
    description,
    domain,
    period_start,
    period_end,
    spatial_min_lat,
    spatial_max_lat,
    spatial_min_lng,
    spatial_max_lng,
    spatial_region_name,
    classification,
    existingDatasetId,
  } = req.body;

  if (!title) return res.status(400).json({ error: "title is required" });

  const buffer = req.file.buffer;
  const format = inferFormat(req.file.mimetype, req.file.originalname);

  if (!matchesSignature(buffer, format)) {
    await recordEvent({
      event_type: "UPLOAD_REJECTED_SIGNATURE_MISMATCH",
      actor_id: req.user.id,
      details: { filename: req.file.originalname, declaredFormat: format },
    });
    return res.status(415).json({
      error: `File content doesn't match its declared type (${format}). The file may be mislabeled or corrupted.`,
    });
  }

  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

  // ---- STAGE 2: exact-duplicate check happens BEFORE we spend storage/CPU ----
  const exactMatch = await findExactDuplicate(sha256);
  if (exactMatch) {
    await recordEvent({
      event_type: "DUPLICATE_DETECTED",
      actor_id: req.user.id,
      resource_type: "dataset_version",
      resource_id: exactMatch.id,
      details: { relationshipType: "exact_duplicate", sha256 },
    });
    return res.status(200).json({
      status: "exact_duplicate",
      message: "An identical file already exists in the registry.",
      existing: {
        datasetVersionId: exactMatch.id,
        title: exactMatch.title,
        classification: exactMatch.classification,
        ownerDepartment: exactMatch.owner_department,
        uploadedAt: exactMatch.uploaded_at,
      },
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let datasetId = existingDatasetId;
    let versionNum = 1;

    if (datasetId) {
      const { rows } = await client.query(
        "SELECT COALESCE(MAX(version_num), 0) + 1 AS next_version FROM dataset_versions WHERE dataset_id = $1",
        [datasetId]
      );
      versionNum = rows[0].next_version;
    } else {
      const { rows } = await client.query(
        `INSERT INTO datasets (title, description, domain, owner_department, classification)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [title, description || null, domain || null, req.user.department, classification || "internal"]
      );
      datasetId = rows[0].id;
    }

    const versionId = uuidv4();
    const storageKey = `${datasetId}/${versionId}`;

    // Encrypt at rest before it ever touches object storage.
    const encrypted = encryptBuffer(buffer);
    await putObject(storageKey, encrypted);

    await client.query(
      `INSERT INTO dataset_versions
        (id, dataset_id, version_num, original_filename, format, size_bytes, sha256,
         storage_key, period_start, period_end, spatial_min_lat, spatial_max_lat,
         spatial_min_lng, spatial_max_lng, spatial_region_name, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        versionId,
        datasetId,
        versionNum,
        req.file.originalname,
        format,
        buffer.length,
        sha256,
        storageKey,
        period_start || null,
        period_end || null,
        spatial_min_lat || null,
        spatial_max_lat || null,
        spatial_min_lng || null,
        spatial_max_lng || null,
        spatial_region_name || null,
        req.user.id,
      ]
    );

    await recordEvent(
      {
        event_type: "UPLOAD",
        actor_id: req.user.id,
        resource_type: "dataset_version",
        resource_id: versionId,
        details: { datasetId, sha256, sizeBytes: buffer.length },
      },
      client
    );

    await client.query("COMMIT");

    // Hand off the expensive part (structural fingerprint + similarity scan
    // + search indexing) to the async worker — the API responds now.
    await enqueueFingerprintJob({ datasetVersionId: versionId, storageKey, format });

    res.status(201).json({
      status: "accepted",
      datasetId,
      datasetVersionId: versionId,
      message: "No exact duplicate found. File stored; similarity analysis running in background.",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[upload] failed:", err);
    res.status(500).json({ error: "Upload failed" });
  } finally {
    client.release();
  }
});

/**
 * GET /api/upload/:versionId/status
 * Poll this after upload to see if the async similarity engine found a match.
 */
router.get("/:versionId/status", requireAuth, pollLimiter, async (req, res) => {
  const { versionId } = req.params;

  const versionResult = await pool.query(
    "SELECT schema_fingerprint FROM dataset_versions WHERE id = $1",
    [versionId]
  );
  if (versionResult.rows.length === 0) {
    return res.status(404).json({ error: "Not found" });
  }

  const relResult = await pool.query(
    `SELECT * FROM version_relationships WHERE version_a_id = $1 OR version_b_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [versionId]
  );

  res.json({
    fingerprintReady: versionResult.rows[0].schema_fingerprint !== null,
    relationship: relResult.rows[0] || null,
  });
});

module.exports = router;
