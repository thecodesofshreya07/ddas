const pool = require("../db/pool");
const { compareSchemaFingerprints, contentSimilarity } = require("./structuralFingerprint");
const { textSimilarityScore } = require("./textSimilarity");

/**
 * STAGE 1 — Candidate generation.
 *
 * Never compare a new upload against every row in the registry. Narrow
 * down using cheap, indexed filters first (size range, domain, rough time
 * overlap) before running any expensive comparison. This is the answer to
 * "how does this scale to millions of datasets" in Q&A.
 */
async function getCandidates({ domain, sizeBytes, periodStart, periodEnd }) {
  const sizeMin = Math.floor(sizeBytes * 0.5);
  const sizeMax = Math.ceil(sizeBytes * 1.5);

  const { rows } = await pool.query(
    `SELECT dv.*, d.title, d.description, d.domain, d.classification, d.owner_department
     FROM dataset_versions dv
     JOIN datasets d ON d.id = dv.dataset_id
     WHERE d.status = 'active'
       AND dv.size_bytes BETWEEN $1 AND $2
       AND ($3::text IS NULL OR d.domain = $3)
     ORDER BY dv.uploaded_at DESC
     LIMIT 200`,
    [sizeMin, sizeMax, domain || null]
  );

  return rows;
}

/**
 * STAGE 2 — Exact duplicate check via SHA-256.
 * DB-enforced uniqueness on dataset_versions.sha256 already guarantees this
 * at the data layer; this helper is used for the pre-insert check so we can
 * return a friendly alert instead of a raw constraint violation.
 */
async function findExactDuplicate(sha256) {
  const { rows } = await pool.query(
    `SELECT dv.*, d.title, d.classification, d.owner_department
     FROM dataset_versions dv
     JOIN datasets d ON d.id = dv.dataset_id
     WHERE dv.sha256 = $1`,
    [sha256]
  );
  return rows[0] || null;
}

function periodOverlapScore(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !aEnd || !bStart || !bEnd) return 0;
  const start = new Date(Math.max(new Date(aStart), new Date(bStart)));
  const end = new Date(Math.min(new Date(aEnd), new Date(bEnd)));
  const overlapMs = Math.max(0, end - start);
  const totalMs = Math.max(new Date(aEnd) - new Date(aStart), new Date(bEnd) - new Date(bStart));
  if (totalMs <= 0) return 0;
  return Math.round((overlapMs / totalMs) * 100 * 100) / 100;
}

function spatialOverlapScore(a, b) {
  const required = [a.spatial_min_lat, a.spatial_max_lat, a.spatial_min_lng, a.spatial_max_lng,
  b.spatial_min_lat, b.spatial_max_lat, b.spatial_min_lng, b.spatial_max_lng];
  if (required.some((v) => v === null || v === undefined)) return 0;

  const latOverlap = Math.max(
    0,
    Math.min(a.spatial_max_lat, b.spatial_max_lat) - Math.max(a.spatial_min_lat, b.spatial_min_lat)
  );
  const lngOverlap = Math.max(
    0,
    Math.min(a.spatial_max_lng, b.spatial_max_lng) - Math.max(a.spatial_min_lng, b.spatial_min_lng)
  );
  const overlapArea = latOverlap * lngOverlap;

  const areaA = (a.spatial_max_lat - a.spatial_min_lat) * (a.spatial_max_lng - a.spatial_min_lng);
  const areaB = (b.spatial_max_lat - b.spatial_min_lat) * (b.spatial_max_lng - b.spatial_min_lng);
  const smallerArea = Math.min(areaA, areaB) || 1;

  return Math.round((overlapArea / smallerArea) * 100 * 100) / 100;
}

function metadataSimilarityScore(a, b) {
  // Simple filename/title fuzzy overlap using normalized token sets —
  // deliberately cheap; the real work happens in textSimilarityScore.
  return textSimilarityScore(a.original_filename || a.title, b.original_filename || b.title);
}

/**
 * STAGE 3 — Explainable weighted similarity score.
 * Weights are configurable; defaults below match the blueprint's suggested
 * split (content/schema-heavy, since that's the most reliable signal for
 * structured government/research datasets).
 */
const DEFAULT_WEIGHTS = {
  content: 0.65,
  schema: 0.20,
  metadata: 0.10,
  temporal: 0.02,
  spatial: 0.01,
  semantic: 0.02,
};

function scoreCandidate(newVersion, candidate, weights = DEFAULT_WEIGHTS) {
  const isExactByteMatch = Boolean(
    newVersion.sha256 &&
    candidate.sha256 &&
    newVersion.sha256 === candidate.sha256
  );

  if (isExactByteMatch) {
    return {
      totalScore: 100,
      breakdown: { content: 100, schema: 100, metadata: 100, temporal: 100, spatial: 100, semantic: 100 },
      isExact: true,
    };
  }

  const sigNew = newVersion.schema_fingerprint?.contentSignature || newVersion.contentSignature;
  const sigCand = candidate.schema_fingerprint?.contentSignature || candidate.contentSignature;
  const hasContentSig = Boolean((sigNew?.hashes?.length || sigNew?.rowHashes?.length) && (sigCand?.hashes?.length || sigCand?.rowHashes?.length));

  const content = hasContentSig ? contentSimilarity(sigNew, sigCand) : 0;
  const schema = compareSchemaFingerprints(
    newVersion.schema_fingerprint,
    candidate.schema_fingerprint
  );
  const metadata = metadataSimilarityScore(newVersion, candidate);
  const temporal = periodOverlapScore(
    newVersion.period_start,
    newVersion.period_end,
    candidate.period_start,
    candidate.period_end
  );
  const spatial = spatialOverlapScore(newVersion, candidate);
  const semantic = textSimilarityScore(
    `${newVersion.title || ""} ${newVersion.description || ""}`,
    `${candidate.title || ""} ${candidate.description || ""}`
  );

  const breakdown = { content, schema, metadata, temporal, spatial, semantic };

  let total;
  if (hasContentSig) {
    total =
      content * weights.content +
      schema * weights.schema +
      metadata * weights.metadata +
      temporal * weights.temporal +
      spatial * weights.spatial +
      semantic * weights.semantic;

    if (content < 100 && total >= 99.5) {
      total = Math.min(total, content);
    }
  } else {
    const remainingWeight = weights.schema + weights.metadata + weights.temporal + weights.spatial + weights.semantic;
    total =
      (schema * weights.schema +
        metadata * weights.metadata +
        temporal * weights.temporal +
        spatial * weights.spatial +
        semantic * weights.semantic) / (remainingWeight || 1);
  }

  if (!isExactByteMatch && total >= 100) {
    total = 99.0;
  }

  return { totalScore: Math.round(total * 100) / 100, breakdown, isExact: false };
}

/**
 * Classifies the relationship type based on score + row-count comparison.
 * Exact duplicate is ONLY returned when byte hashes match or score is 100%.
 */
function classifyRelationship(newVersion, candidate, totalScore, isExact = false) {
  if (isExact || (candidate.sha256 && newVersion.sha256 && candidate.sha256 === newVersion.sha256)) {
    return "exact_duplicate";
  }

  const newRows = newVersion.schema_fingerprint?.rowCount || 0;
  const candRows = candidate.schema_fingerprint?.rowCount || 0;

  if (totalScore >= 85) {
    if (newRows > candRows * 1.2) return "superset";
    if (newRows < candRows * 0.8) return "subset";
    return "near_duplicate";
  }
  if (totalScore >= 60) return "related";
  return "distinct";
}

/**
 * Full pipeline: candidate generation -> scoring -> best match.
 * Returns null if nothing scores above the "related" threshold.
 */
async function findBestMatch(newVersion) {
  const candidates = await getCandidates({
    domain: newVersion.domain,
    sizeBytes: newVersion.size_bytes,
  });

  let best = null;
  for (const candidate of candidates) {
    const { totalScore, breakdown, isExact } = scoreCandidate(newVersion, candidate);
    if (!best || totalScore > best.totalScore) {
      best = {
        candidate,
        totalScore,
        breakdown,
        isExact,
        relationshipType: classifyRelationship(newVersion, candidate, totalScore, isExact),
      };
    }
  }

  if (!best || best.totalScore < 60) return null;
  return best;
}

module.exports = {
  getCandidates,
  findExactDuplicate,
  scoreCandidate,
  classifyRelationship,
  findBestMatch,
  DEFAULT_WEIGHTS,
};
