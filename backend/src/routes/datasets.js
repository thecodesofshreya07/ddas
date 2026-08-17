const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { enforce } = require("../middleware/policy");
const { searchDatasets } = require("../services/search");
const { getObject, deleteObject } = require("../services/storage");
const { recordEvent } = require("../services/auditLog");
const { findExactDuplicate, findBestMatch, filenameSimilarity } = require("../services/duplicateEngine");

const router = express.Router();

/**
 * GET /api/datasets/search?q=...&domain=...&department=...
 * Discovery layer — search BEFORE download, so users can find and reuse
 * existing data instead of re-downloading it.
 */
router.get("/search", requireAuth, async (req, res) => {
  const { q, domain, department, periodFrom, periodTo, minLat, maxLat, minLng, maxLng } = req.query;

  const bbox =
    minLat && maxLat && minLng && maxLng
      ? {
        minLat: parseFloat(minLat),
        maxLat: parseFloat(maxLat),
        minLng: parseFloat(minLng),
        maxLng: parseFloat(maxLng),
      }
      : null;

  const results = await searchDatasets({ query: q, domain, department, periodFrom, periodTo, bbox });

  // Post-filter by ABAC — Elasticsearch is a discovery aid, not the
  // authorization boundary. Restricted items the user can't see are
  // silently dropped, not flagged, to avoid leaking existence.
  const visible = [];
  for (const r of results) {
    const { evaluatePolicy } = require("../middleware/policy");
    const effect = await evaluatePolicy({
      role: req.user.role,
      department: req.user.department,
      classification: r.classification,
      action: "view",
    });
    if (effect === "allow") visible.push(r);
  }

  res.json({ results: visible });
});

/**
 * Loads a dataset by id and attaches it as req.resource for the policy
 * middleware. Used as a param-based loader ahead of `enforce()`.
 */
async function loadDataset(req, res, next) {
  const { rows } = await pool.query("SELECT * FROM datasets WHERE id = $1", [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: "Not found" });
  req.resource = rows[0];
  next();
}

router.get("/:id", requireAuth, loadDataset, enforce("view"), async (req, res) => {
  const versions = await pool.query(
    "SELECT * FROM dataset_versions WHERE dataset_id = $1 ORDER BY version_num DESC",
    [req.params.id]
  );
  res.json({ dataset: req.resource, versions: versions.rows });
});

/**
 * GET /api/datasets/:id/relationships
 * Powers the lineage graph UI (duplicate/version/subset/superset/related).
 */
router.get("/:id/relationships", requireAuth, loadDataset, enforce("view"), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT vr.*, dv1.dataset_id AS a_dataset, dv2.dataset_id AS b_dataset
     FROM version_relationships vr
     JOIN dataset_versions dv1 ON dv1.id = vr.version_a_id
     JOIN dataset_versions dv2 ON dv2.id = vr.version_b_id
     WHERE dv1.dataset_id = $1 OR dv2.dataset_id = $1`,
    [req.params.id]
  );
  res.json({ relationships: rows });
});

/**
 * POST /api/datasets/versions/:versionId/download
 * The pre-download alert lives here: if a strong match exists, we return
 * the alert payload instead of the file, and the client decides whether to
 * call this again with ?force=true (which the UI does after "Continue Anyway").
 */
router.post("/versions/:versionId/download", requireAuth, async (req, res) => {
  const { versionId } = req.params;
  const force = req.query.force === "true";

  const { rows } = await pool.query(
    `SELECT dv.*, d.classification, d.owner_department, d.title
     FROM dataset_versions dv JOIN datasets d ON d.id = dv.dataset_id
     WHERE dv.id = $1`,
    [versionId]
  );
  if (rows.length === 0) return res.status(404).json({ error: "Not found" });
  const version = rows[0];

  const { evaluatePolicy } = require("../middleware/policy");
  const effect = await evaluatePolicy({
    role: req.user.role,
    department: req.user.department,
    classification: version.classification,
    action: "download",
  });
  if (effect !== "allow") {
    await recordEvent({
      event_type: "DOWNLOAD_DENIED",
      actor_id: req.user.id,
      resource_type: "dataset_version",
      resource_id: versionId,
    });
    return res.status(404).json({ error: "Not found" });
  }

  if (!force) {
    const relResult = await pool.query(
      `SELECT * FROM version_relationships
       WHERE (version_a_id = $1 OR version_b_id = $1) AND relationship_type != 'distinct'
       ORDER BY similarity_score DESC LIMIT 1`,
      [versionId]
    );
    if (relResult.rows.length > 0) {
      const rel = relResult.rows[0];
      await recordEvent({
        event_type: "DOWNLOAD_ALERT_SHOWN",
        actor_id: req.user.id,
        resource_type: "dataset_version",
        resource_id: versionId,
        details: { relationshipType: rel.relationship_type, score: rel.similarity_score },
      });
      return res.status(200).json({
        status: "alert",
        relationship: rel,
        message: "A similar or identical dataset may already exist. Review before downloading.",
      });
    }
  }

  // No match, or user explicitly chose to continue — proceed with download.
  const encrypted = await getObject(version.storage_key);
  const buffer = decryptBuffer(encrypted);

  await pool.query(
    `INSERT INTO downloads (dataset_version_id, user_id, was_alerted, action_taken, bytes_saved)
     VALUES ($1, $2, $3, $4, $5)`,
    [versionId, req.user.id, force, force ? "continued_anyway" : "first_download", 0]
  );

  await recordEvent({
    event_type: "DOWNLOAD_ALLOWED",
    actor_id: req.user.id,
    resource_type: "dataset_version",
    resource_id: versionId,
  });

  res.set("Content-Disposition", `attachment; filename="${version.original_filename}"`);
  res.set("Content-Type", "application/octet-stream");
  res.send(buffer);
});

/**
 * POST /api/datasets/versions/:versionId/reuse
 * "Use Existing Dataset" — records that the user chose reuse over a fresh
 * download, which is the actual bandwidth-saving outcome the whole system
 * exists to encourage. bytes_saved is credited to the dashboard here.
 */
router.post("/versions/:versionId/reuse", requireAuth, async (req, res) => {
  const { versionId } = req.params;
  const { rows } = await pool.query("SELECT size_bytes FROM dataset_versions WHERE id = $1", [versionId]);
  if (rows.length === 0) return res.status(404).json({ error: "Not found" });

  await pool.query(
    `INSERT INTO downloads (dataset_version_id, user_id, was_alerted, action_taken, bytes_saved)
     VALUES ($1, $2, true, 'used_existing', $3)`,
    [versionId, req.user.id, rows[0].size_bytes]
  );

  await recordEvent({
    event_type: "DATASET_REUSED",
    actor_id: req.user.id,
    resource_type: "dataset_version",
    resource_id: versionId,
    details: { bytesSaved: rows[0].size_bytes },
  });

  res.json({ status: "ok", message: "Marked as reused. No new download performed." });
});

/**
 * DELETE /api/datasets/versions/:versionId
 * The "discard this upload" action — the real decision point after
 * reviewing the content diff against an existing version. Only the
 * uploader or an admin can discard, and only within a short window after
 * upload, so this can't quietly rewrite registry history.
 */
router.delete("/versions/:versionId", requireAuth, async (req, res) => {
  const { versionId } = req.params;

  const { rows } = await pool.query(
    `SELECT dv.*, d.id AS dataset_id
     FROM dataset_versions dv JOIN datasets d ON d.id = dv.dataset_id
     WHERE dv.id = $1`,
    [versionId]
  );
  if (rows.length === 0) return res.status(404).json({ error: "Not found" });
  const version = rows[0];

  const isOwner = version.uploaded_by === req.user.id;
  const isAdmin = req.user.role === "admin";
  if (!isOwner && !isAdmin) {
    return res.status(403).json({ error: "Only the uploader or an admin can discard this upload" });
  }

  const ageMs = Date.now() - new Date(version.uploaded_at).getTime();
  const DISCARD_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
  if (!isAdmin && ageMs > DISCARD_WINDOW_MS) {
    return res.status(403).json({
      error: "This upload is too old to discard — contact an administrator to remove it.",
    });
  }

  const client = await pool.connect();
  let datasetDeleted = false;
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM dataset_versions WHERE id = $1", [versionId]);

    const remaining = await client.query(
      "SELECT COUNT(*) AS count FROM dataset_versions WHERE dataset_id = $1",
      [version.dataset_id]
    );
    if (parseInt(remaining.rows[0].count, 10) === 0) {
      await client.query("DELETE FROM datasets WHERE id = $1", [version.dataset_id]);
      datasetDeleted = true;
    }

    await recordEvent(
      {
        event_type: "UPLOAD_DISCARDED",
        actor_id: req.user.id,
        resource_type: "dataset_version",
        resource_id: versionId,
        details: { datasetId: version.dataset_id, datasetDeleted },
      },
      client
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[discard] failed:", err);
    return res.status(500).json({ error: "Failed to discard upload" });
  } finally {
    client.release();
  }

  await deleteObject(version.storage_key).catch((err) =>
    console.warn("[discard] storage cleanup failed (non-fatal):", err.message)
  );

  res.json({ status: "discarded", datasetDeleted });
});

/**
 * GET /api/datasets/dashboard/attention
 * Real, data-backed "requires attention" feed — NOT a fabricated alert
 * workflow. There is no alerts table with New/Investigating/Resolved
 * states yet (that's real backend work, not built), so this surfaces two
 * things that genuinely exist: high-similarity matches detected recently,
 * and downloads that proceeded despite an alert being shown.
 */
router.get("/dashboard/attention", requireAuth, async (req, res) => {
  const highSimilarity = await pool.query(
    `SELECT vr.id, vr.relationship_type, vr.similarity_score, vr.created_at,
            d.id AS dataset_id, d.title
     FROM version_relationships vr
     JOIN dataset_versions dv ON dv.id = vr.version_a_id
     JOIN datasets d ON d.id = dv.dataset_id
     WHERE vr.similarity_score >= 85
     ORDER BY vr.created_at DESC LIMIT 5`
  );

  const continuedDespiteAlert = await pool.query(
    `SELECT dl.id, dl.downloaded_at, u.name AS user_name, d.title, d.id AS dataset_id
     FROM downloads dl
     JOIN dataset_versions dv ON dv.id = dl.dataset_version_id
     JOIN datasets d ON d.id = dv.dataset_id
     JOIN users u ON u.id = dl.user_id
     WHERE dl.was_alerted = true AND dl.action_taken = 'continued_anyway'
     ORDER BY dl.downloaded_at DESC LIMIT 5`
  );

  res.json({
    highSimilarityMatches: highSimilarity.rows,
    continuedDespiteAlert: continuedDespiteAlert.rows,
  });
});

/**
 * GET /api/datasets/audit/recent?limit=15
 * Real activity feed for the dashboard timeline, sourced directly from the
 * hash-chained audit log — not a separate/fabricated events system.
 * Non-admins see only their own actions; admins see everything.
 */
router.get("/audit/recent", requireAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 15, 50);

  const params = [limit];
  let whereClause = "";
  if (req.user.role !== "admin") {
    whereClause = "WHERE al.actor_id = $2";
    params.push(req.user.id);
  }

  const { rows } = await pool.query(
    `SELECT al.id, al.event_type, al.resource_type, al.resource_id, al.details,
            al.created_at, u.name AS actor_name
     FROM audit_log al
     LEFT JOIN users u ON u.id = al.actor_id
     ${whereClause}
     ORDER BY al.id DESC
     LIMIT $1`,
    params
  );

  res.json({ events: rows });
});

/**
 * POST /api/datasets/check
 *
 * The browser-extension entry point. Checks if an incoming download is already
 * in the central registry (exact or near-duplicate), and evaluates ABAC policy
 * to determine whether the user is authorized to see the full location.
 */
router.post("/check", requireAuth, async (req, res) => {
  const {
    sha256,
    sizeBytes,
    filename,
    title,
    domain,
    schemaFingerprint,
    contentSignature,
    periodStart,
    periodEnd,
    spatialMinLat,
    spatialMaxLat,
    spatialMinLng,
    spatialMaxLng,
    spatialRegionName,
    sourceUrl,
  } = req.body;

  if (!sha256 || !sizeBytes) {
    return res.status(400).json({ error: "sha256 and sizeBytes are required" });
  }

  const { evaluatePolicy } = require("../middleware/policy");

  const exactMatch = await findExactDuplicate(sha256);
  if (exactMatch) {
    const originalStoredName = exactMatch.original_filename || exactMatch.title || "Stored dataset";
    const metaSim = filenameSimilarity(filename || title || "", originalStoredName);

    // Evaluate ABAC for requesting user
    const effect = await evaluatePolicy({
      role: req.user.role,
      department: req.user.department,
      classification: exactMatch.classification,
      action: "view",
    });
    const hasAccess = effect === "allow";

    await recordEvent({
      event_type: "EXTENSION_DUPLICATE_DETECTED",
      actor_id: req.user.id,
      resource_type: "dataset_version",
      resource_id: exactMatch.id,
      details: { filename, sourceUrl, relationshipType: "exact_duplicate", hasAccess },
    });

    const existingPayload = hasAccess
      ? {
          datasetId: exactMatch.dataset_id,
          datasetVersionId: exactMatch.id,
          title: exactMatch.title || originalStoredName,
          fileName: originalStoredName,
          classification: exactMatch.classification,
          ownerDepartment: exactMatch.owner_department,
          uploadedAt: exactMatch.uploaded_at,
          downloaderUsername: exactMatch.uploaded_by_username || exactMatch.username || "rahul",
          downloadLocation: `${exactMatch.owner_department || "Registry"} / ${exactMatch.storage_key || "central_storage"}`,
          downloadedAt: exactMatch.uploaded_at,
          periodStart: exactMatch.period_start || null,
          periodEnd: exactMatch.period_end || null,
          spatialRegionName: exactMatch.spatial_region_name || null,
          locationUrl: `http://localhost:5173/datasets/${exactMatch.dataset_id}`,
          hasAccess: true,
        }
      : {
          datasetId: null,
          datasetVersionId: null,
          title: "Restricted Dataset (Access Controlled)",
          fileName: originalStoredName,
          classification: exactMatch.classification || "restricted",
          ownerDepartment: exactMatch.owner_department ? `${exactMatch.owner_department} Department` : "Restricted Custodian",
          uploadedAt: exactMatch.uploaded_at,
          downloaderUsername: null,
          downloadLocation: null,
          downloadedAt: null,
          periodStart: exactMatch.period_start || null,
          periodEnd: exactMatch.period_end || null,
          spatialRegionName: exactMatch.spatial_region_name || null,
          locationUrl: null,
          hasAccess: false,
          restrictedNote: "Classification: Restricted — Access restricted to custodian department. Contact data administrator to request access.",
        };

    return res.json({
      status: "exact_duplicate",
      relationshipType: "exact_duplicate",
      similarityScore: 100.0,
      breakdown: { content: 100.0, schema: 100.0, metadata: metaSim },
      existing: existingPayload,
    });
  }

  const candidateShape = {
    size_bytes: sizeBytes,
    domain: domain || null,
    title: title || filename,
    description: "",
    original_filename: filename,
    schema_fingerprint: schemaFingerprint ? { ...schemaFingerprint, contentSignature } : (contentSignature ? { contentSignature } : null),
    period_start: periodStart || null,
    period_end: periodEnd || null,
    spatial_min_lat: spatialMinLat ?? null,
    spatial_max_lat: spatialMaxLat ?? null,
    spatial_min_lng: spatialMinLng ?? null,
    spatial_max_lng: spatialMaxLng ?? null,
    spatial_region_name: spatialRegionName || null,
  };

  const match = await findBestMatch(candidateShape);

  if (match && match.totalScore >= 60.0) {
    const candidate = match.candidate;
    const originalStoredName = candidate.original_filename || candidate.title || "Stored dataset";

    // Evaluate ABAC for requesting user
    const effect = await evaluatePolicy({
      role: req.user.role,
      department: req.user.department,
      classification: candidate.classification,
      action: "view",
    });
    const hasAccess = effect === "allow";

    await recordEvent({
      event_type: "EXTENSION_DUPLICATE_DETECTED",
      actor_id: req.user.id,
      resource_type: "dataset",
      resource_id: candidate.dataset_id,
      details: {
        filename,
        sourceUrl,
        relationshipType: match.relationshipType,
        score: match.totalScore,
        hasAccess,
      },
    });

    const existingPayload = hasAccess
      ? {
          datasetId: candidate.dataset_id,
          datasetVersionId: candidate.id,
          title: candidate.title || originalStoredName,
          fileName: originalStoredName,
          classification: candidate.classification,
          ownerDepartment: candidate.owner_department,
          uploadedAt: candidate.uploaded_at,
          downloaderUsername: candidate.uploaded_by_username || candidate.username || "rahul",
          downloadLocation: `${candidate.owner_department || "Registry"} / ${candidate.storage_key || "central_storage"}`,
          downloadedAt: candidate.uploaded_at,
          periodStart: candidate.period_start || null,
          periodEnd: candidate.period_end || null,
          spatialRegionName: candidate.spatial_region_name || null,
          locationUrl: `http://localhost:5173/datasets/${candidate.dataset_id}`,
          hasAccess: true,
        }
      : {
          datasetId: null,
          datasetVersionId: null,
          title: "Restricted Dataset (Access Controlled)",
          fileName: originalStoredName,
          classification: candidate.classification || "restricted",
          ownerDepartment: candidate.owner_department ? `${candidate.owner_department} Department` : "Restricted Custodian",
          uploadedAt: candidate.uploaded_at,
          downloaderUsername: null,
          downloadLocation: null,
          downloadedAt: null,
          periodStart: candidate.period_start || null,
          periodEnd: candidate.period_end || null,
          spatialRegionName: candidate.spatial_region_name || null,
          locationUrl: null,
          hasAccess: false,
          restrictedNote: "Classification: Restricted — Access restricted to custodian department. Contact data administrator to request access.",
        };

    return res.json({
      status: match.totalScore >= 80.0 ? "similar" : "related",
      relationshipType: match.relationshipType,
      similarityScore: match.totalScore,
      breakdown: match.breakdown,
      existing: existingPayload,
    });
  }

  await recordEvent({
    event_type: "EXTENSION_CHECK_CLEAR",
    actor_id: req.user.id,
    details: { filename, sourceUrl },
  });

  res.json({ status: "none" });
});

/**
 * POST /api/datasets/register-download
 *
 * PS Gap 1: Auto-registers completed downloads into the central registry.
 * If the identical file already exists, links this download event to the existing
 * canonical record. Otherwise, creates a new canonical dataset & version entry
 * so that any other user downloading the file later will get a duplicate alert.
 */
router.post("/register-download", requireAuth, async (req, res) => {
  const {
    sha256,
    sizeBytes,
    filename,
    title,
    domain,
    schemaFingerprint,
    contentSignature,
    sourceUrl,
    classification,
    periodStart,
    periodEnd,
    spatialRegionName,
    spatialMinLat,
    spatialMaxLat,
    spatialMinLng,
    spatialMaxLng,
  } = req.body;

  if (!sha256 || !sizeBytes) {
    return res.status(400).json({ error: "sha256 and sizeBytes are required" });
  }

  const exactMatch = await findExactDuplicate(sha256);
  if (exactMatch) {
    // Canonical record already exists — link this download event with attribution
    const currentUsername = req.user.username || req.user.name || "user";
    const currentDept = req.user.department || "General";
    const downloadLocation = `${exactMatch.owner_department || "Registry"} / ${exactMatch.storage_key || "central_storage"}`;

    await pool.query(
      `INSERT INTO downloads (dataset_version_id, user_id, was_alerted, action_taken, bytes_saved, username, department, download_location)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        exactMatch.id,
        req.user.id,
        false,
        "registered_external_download",
        0,
        currentUsername,
        currentDept,
        downloadLocation,
      ]
    );


    await recordEvent({
      event_type: "DOWNLOAD_REGISTERED_LINKED",
      actor_id: req.user.id,
      resource_type: "dataset_version",
      resource_id: exactMatch.id,
      details: { filename, sourceUrl, sha256 },
    });

    return res.json({
      status: "linked",
      datasetId: exactMatch.dataset_id,
      datasetVersionId: exactMatch.id,
      message: "Download linked to existing canonical registry record.",
    });
  }

  // Create new canonical dataset & version entry in registry
  const client = await pool.connect();
  try {
    const { v4: uuidv4 } = require("uuid");
    const { indexDataset } = require("../services/search");

    const datasetTitle = title || filename || "External Download";
    const datasetDomain = domain || "General";
    const datasetClassification = classification || "internal";

    const { rows: dsRows } = await pool.query(
      `INSERT INTO datasets (title, description, domain, owner_department, classification)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        datasetTitle,
        `Auto-registered from external download (${sourceUrl || filename})`,
        datasetDomain,
        req.user.department || "General",
        datasetClassification,
      ]
    );
    const datasetId = dsRows[0].id;
    const versionId = uuidv4();
    const storageKey = `external_downloads/${sha256}`;

    const mergedFingerprint = schemaFingerprint
      ? { ...schemaFingerprint, contentSignature: contentSignature || schemaFingerprint.contentSignature }
      : (contentSignature ? { contentSignature } : null);

    const { rows: dvRows } = await pool.query(
      `INSERT INTO dataset_versions
        (id, dataset_id, version_num, original_filename, format, size_bytes, sha256,
         storage_key, period_start, period_end, spatial_min_lat, spatial_max_lat,
         spatial_min_lng, spatial_max_lng, spatial_region_name, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [
        versionId,
        datasetId,
        1,
        filename || "downloaded_file.csv",
        filename?.endsWith(".json") ? "json" : filename?.endsWith(".pdf") ? "pdf" : "csv",
        sizeBytes,
        sha256,
        storageKey,
        periodStart || null,
        periodEnd || null,
        spatialMinLat ?? null,
        spatialMaxLat ?? null,
        spatialMinLng ?? null,
        spatialMaxLng ?? null,
        spatialRegionName || null,
        req.user.id,
      ]
    );

    // Save schema fingerprint
    if (mergedFingerprint) {
      await pool.query(
        "UPDATE dataset_versions SET schema_fingerprint = $1 WHERE id = $2",
        [mergedFingerprint, versionId]
      );
    }

    // Record in downloads table with attribution
    const currentUsername = req.user.username || req.user.name || "user";
    const currentDept = req.user.department || "General";
    const downloadLocation = `${currentDept} / ${storageKey}`;

    await pool.query(
      `INSERT INTO downloads (dataset_version_id, user_id, was_alerted, action_taken, bytes_saved, username, department, download_location)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [versionId, req.user.id, false, "registered_external_download", 0, currentUsername, currentDept, downloadLocation]
    );


    // Check for near duplicates and record relationships
    const candidateShape = {
      size_bytes: sizeBytes,
      domain: datasetDomain,
      title: datasetTitle,
      description: "",
      original_filename: filename,
      schema_fingerprint: mergedFingerprint,
      period_start: periodStart || null,
      period_end: periodEnd || null,
      spatial_region_name: spatialRegionName || null,
    };
    const nearMatch = await findBestMatch(candidateShape);
    if (nearMatch && nearMatch.totalScore >= 60.0) {
      await pool.query(
        `INSERT INTO version_relationships
          (version_a_id, version_b_id, relationship_type, similarity_score, score_breakdown)
         VALUES ($1, $2, $3, $4, $5)`,
        [versionId, nearMatch.candidate.id, nearMatch.relationshipType, nearMatch.totalScore, nearMatch.breakdown]
      );
    }

    await indexDataset({
      datasetId,
      title: datasetTitle,
      description: `Auto-registered from external download (${sourceUrl || filename})`,
      domain: datasetDomain,
      ownerDepartment: req.user.department || "General",
      classification: datasetClassification,
      spatialRegionName: spatialRegionName || null,
      periodStart: periodStart || null,
      periodEnd: periodEnd || null,
      createdAt: new Date().toISOString(),
    }).catch(() => {});

    await recordEvent({
      event_type: "DOWNLOAD_AUTO_REGISTERED",
      actor_id: req.user.id,
      resource_type: "dataset_version",
      resource_id: versionId,
      details: { datasetId, sha256, filename, sourceUrl },
    });

    res.status(201).json({
      status: "registered",
      datasetId,
      datasetVersionId: versionId,
      message: "External download registered into central institute registry.",
    });
  } catch (err) {
    console.error("[register-download] error:", err);
    res.status(500).json({ error: "Failed to register download" });
  } finally {
    client.release?.();
  }
});


/**
 * GET /api/datasets/dashboard/stats
 * Powers the admin dashboard: bandwidth/storage saved, top duplicated
 * datasets, department usage.
 */
router.get("/dashboard/stats", requireAuth, async (req, res) => {
  const bytesSaved = await pool.query(
    "SELECT COALESCE(SUM(bytes_saved), 0) AS total FROM downloads WHERE action_taken = 'used_existing'"
  );
  const duplicatesPrevented = await pool.query(
    "SELECT COUNT(*) AS total FROM downloads WHERE action_taken = 'used_existing'"
  );
  const topDuplicated = await pool.query(
    `SELECT d.title, COUNT(*) AS alert_count
     FROM version_relationships vr
     JOIN dataset_versions dv ON dv.id = vr.version_a_id
     JOIN datasets d ON d.id = dv.dataset_id
     GROUP BY d.title ORDER BY alert_count DESC LIMIT 5`
  );
  const departmentUsage = await pool.query(
    `SELECT owner_department, COUNT(*) AS dataset_count
     FROM datasets GROUP BY owner_department ORDER BY dataset_count DESC`
  );

  res.json({
    bandwidthSavedBytes: parseInt(bytesSaved.rows[0]?.total || 0, 10),
    duplicateDownloadsPrevented: parseInt(duplicatesPrevented.rows[0]?.total || 0, 10),
    topDuplicatedDatasets: topDuplicated.rows || [],
    departmentUsage: departmentUsage.rows || [],
  });

});

/**
 * GET /api/datasets/audit/verify
 * Live-demo endpoint: proves the audit log hash chain hasn't been tampered
 * with. Admin-only.
 */
router.get("/audit/verify", requireAuth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
  const { verifyChain } = require("../services/auditLog");
  const result = await verifyChain();
  res.json(result);
});

module.exports = router;
