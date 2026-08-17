const crypto = require("crypto");
const { parse } = require("csv-parse");
const { Readable } = require("stream");

/**
 * Builds a structural fingerprint for a CSV buffer: column names, inferred
 * types, row count, and basic per-column stats. Two files with different
 * names/byte layout but the same structural fingerprint are very likely the
 * same dataset re-exported or re-ordered — this is what catches duplicates
 * that SHA-256 alone would miss.
 *
 * Kept intentionally simple (no streaming/parquet support) — good enough
 * for a hackathon demo; the doc's Parquet/JSON/GeoJSON variants are noted
 * as roadmap extensions of this same function.
 */

const MAX_ROWS_HASHED = 5000;

function hashRow(row, columns) {
  const normalized = columns.map((c) => String(row[c] ?? "").trim().toLowerCase()).join("\u0001");
  return crypto.createHash("sha1").update(normalized).digest("hex");
}

function buildContentSignature(records, columns) {
  const sample =
    records.length <= MAX_ROWS_HASHED
      ? records
      : records.filter((_, i) => i % Math.ceil(records.length / MAX_ROWS_HASHED) === 0);
  return {
    rowHashes: sample.map((r) => hashRow(r, columns)),
    totalRows: records.length,
    sampled: sample.length < records.length,
  };
}
async function fingerprintCsv(buffer) {
  const records = await parseCsv(buffer);
  if (records.length === 0) {
    return { columns: [], rowCount: 0, columnStats: {}, contentSignature: null };
  }

  const columns = Object.keys(records[0]);
  const columnStats = {};

  for (const col of columns) {
    const values = records.map((r) => r[col]).filter((v) => v !== undefined && v !== "");
    const numericValues = values.map(Number).filter((v) => !Number.isNaN(v));
    const isNumeric = numericValues.length === values.length && values.length > 0;

    columnStats[col] = {
      inferredType: isNumeric ? "numeric" : "string",
      nullCount: records.length - values.length,
      uniqueCount: new Set(values).size,
      ...(isNumeric
        ? {
          min: Math.min(...numericValues),
          max: Math.max(...numericValues),
        }
        : {}),
    };
  }

  return {
    columns,
    rowCount: records.length,
    columnStats,
    contentSignature: buildContentSignature(records, columns),
  };
}

const CHUNK_SIZE = 8 * 1024; // 8KB chunks
const MAX_CHUNKS_HASHED = 5000;

function fingerprintChunk(buffer) {
  if (!buffer || buffer.length === 0) {
    return { type: "chunk-hashes", hashes: [], rowHashes: [], totalUnits: 0, sampled: false };
  }
  const totalChunks = Math.ceil(buffer.length / CHUNK_SIZE);
  const chunkIndices = [];
  if (totalChunks <= MAX_CHUNKS_HASHED) {
    for (let i = 0; i < totalChunks; i++) chunkIndices.push(i);
  } else {
    const step = Math.ceil(totalChunks / MAX_CHUNKS_HASHED);
    for (let i = 0; i < totalChunks; i += step) chunkIndices.push(i);
  }

  const hashes = chunkIndices.map((idx) => {
    const start = idx * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, buffer.length);
    const slice = buffer.subarray(start, end);
    return crypto.createHash("sha1").update(slice).digest("hex");
  });

  return {
    type: "chunk-hashes",
    hashes,
    rowHashes: hashes,
    totalUnits: totalChunks,
    sampled: chunkIndices.length < totalChunks,
  };
}

/**
 * Multiset-based content similarity: counts matching row/chunk hashes.
 * Accurately returns 98.0% when 2 out of 100 rows change.
 */
function contentSimilarity(sigA, sigB) {
  if (!sigA || !sigB) return 0;
  const typeA = sigA.type || (sigA.rowHashes ? "row-hashes" : null);
  const typeB = sigB.type || (sigB.rowHashes ? "row-hashes" : null);
  if (typeA && typeB && typeA !== typeB) return 0;

  const hashesA = sigA.hashes || sigA.rowHashes || [];
  const hashesB = sigB.hashes || sigB.rowHashes || [];
  if (hashesA.length === 0 || hashesB.length === 0) return 0;

  const countB = new Map();
  for (const h of hashesB) {
    countB.set(h, (countB.get(h) || 0) + 1);
  }

  let matched = 0;
  for (const h of hashesA) {
    const c = countB.get(h) || 0;
    if (c > 0) {
      matched++;
      countB.set(h, c - 1);
    }
  }

  const maxLen = Math.max(hashesA.length, hashesB.length);
  const score = maxLen > 0 ? (matched / maxLen) * 100 : 0;
  return Math.round(score * 100) / 100;
}

function parseCsv(buffer) {
  return new Promise((resolve, reject) => {
    const records = [];
    Readable.from(buffer)
      .pipe(parse({ columns: true, skip_empty_lines: true, relax_column_count: true }))
      .on("data", (row) => records.push(row))
      .on("end", () => resolve(records))
      .on("error", reject);
  });
}

/**
 * Compares two structural fingerprints and returns a 0-100 schema similarity
 * score based on column-name overlap, type agreement, and row-count ratio.
 */
function compareSchemaFingerprints(a, b) {
  if (!a || !b || !a.columns || !b.columns || a.columns.length === 0 || b.columns.length === 0) return 0;

  const setA = new Set(a.columns.map((c) => c.toLowerCase().trim()));
  const setB = new Set(b.columns.map((c) => c.toLowerCase().trim()));
  const intersection = [...setA].filter((c) => setB.has(c));
  const union = new Set([...setA, ...setB]);

  const columnOverlap = union.size === 0 ? 0 : intersection.length / union.size;

  const rowRatio =
    Math.min(a.rowCount || 0, b.rowCount || 0) / Math.max(a.rowCount || 1, b.rowCount || 1);

  let typeAgreement = 1;
  if (intersection.length > 0 && a.columnStats && b.columnStats) {
    const matches = intersection.filter(
      (c) => a.columnStats[c]?.inferredType === b.columnStats[c]?.inferredType
    ).length;
    typeAgreement = matches / intersection.length;
  }

  const score = columnOverlap * 0.5 + rowRatio * 0.25 + typeAgreement * 0.25;
  return Math.round(score * 100 * 100) / 100; // 2 decimal places
}

module.exports = {
  fingerprintCsv,
  fingerprintChunk,
  compareSchemaFingerprints,
  contentSimilarity,
};
