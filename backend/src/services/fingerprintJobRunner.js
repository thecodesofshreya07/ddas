const pool = require("../db/pool");
const { getObject } = require("./storage");
const { decryptBuffer } = require("./crypto");
const { fingerprintCsv, fingerprintChunk } = require("./structuralFingerprint");
const { findBestMatch } = require("./duplicateEngine");
const { computeContentDiff } = require("./contentDiff");
const { indexDataset } = require("./search");
const { recordEvent } = require("./auditLog");

async function processFingerprintJob(data) {
  const { datasetVersionId, storageKey, format } = data;
  console.log(`[job-runner] processing dataset version ${datasetVersionId}`);

  const encrypted = await getObject(storageKey);
  const buffer = decryptBuffer(encrypted);

  let schemaFingerprint = null;
  if (format === "csv") {
    schemaFingerprint = await fingerprintCsv(buffer);
  } else {
    const chunkSig = fingerprintChunk(buffer);
    schemaFingerprint = {
      format,
      sizeBytes: buffer.length,
      contentSignature: chunkSig,
    };
  }

  await pool.query(
    `UPDATE dataset_versions SET schema_fingerprint = $1 WHERE id = $2`,
    [schemaFingerprint, datasetVersionId]
  );

  const { rows } = await pool.query(
    `SELECT dv.*, d.title, d.description, d.domain, d.classification, d.owner_department
     FROM dataset_versions dv JOIN datasets d ON d.id = dv.dataset_id
     WHERE dv.id = $1`,
    [datasetVersionId]
  );
  const thisVersion = rows[0];
  if (!thisVersion) return { schemaFingerprint };

  const match = await findBestMatch(thisVersion);

  if (match && match.candidate.id !== thisVersion.id) {
    let contentDiff = null;
    if (match.relationshipType !== "exact_duplicate") {
      try {
        const candidateEncrypted = await getObject(match.candidate.storage_key);
        const candidateBuffer = decryptBuffer(candidateEncrypted);
        contentDiff = await computeContentDiff(
          candidateBuffer,
          buffer,
          match.candidate.format,
          format
        );
      } catch (err) {
        console.warn(`[job-runner] content diff failed for ${thisVersion.id}:`, err.message);
      }
    }

    await pool.query(
      `INSERT INTO version_relationships
        (version_a_id, version_b_id, relationship_type, similarity_score, score_breakdown, content_diff)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        thisVersion.id,
        match.candidate.id,
        match.relationshipType,
        match.totalScore,
        match.breakdown,
        contentDiff,
      ]
    );

    await recordEvent({
      event_type: "DUPLICATE_DETECTED",
      resource_type: "dataset_version",
      resource_id: thisVersion.id,
      details: {
        matchedVersionId: match.candidate.id,
        relationshipType: match.relationshipType,
        score: match.totalScore,
        breakdown: match.breakdown,
        contentDiffType: contentDiff?.type,
      },
    });
  }

  await indexDataset({
    dataset_id: thisVersion.dataset_id,
    title: thisVersion.title,
    description: thisVersion.description,
    domain: thisVersion.domain,
    owner_department: thisVersion.owner_department,
    classification: thisVersion.classification,
    spatial_region_name: thisVersion.spatial_region_name,
    spatial_min_lat: thisVersion.spatial_min_lat,
    spatial_max_lat: thisVersion.spatial_max_lat,
    spatial_min_lng: thisVersion.spatial_min_lng,
    spatial_max_lng: thisVersion.spatial_max_lng,
    period_start: thisVersion.period_start,
    period_end: thisVersion.period_end,
    created_at: thisVersion.uploaded_at,
  });

  console.log(`[job-runner] completed version ${datasetVersionId}`);
  return { schemaFingerprint, match };
}

module.exports = { processFingerprintJob };
