// Runs inside background service worker and content scripts — Web Crypto compatible.

const MAX_CSV_PARSE_BYTES = 10 * 1024 * 1024; // 10MB cap for in-browser CSV parsing
const MAX_ROWS_HASHED = 50000;                // sample beyond 50k rows
const CHUNK_SIZE = 8 * 1024;                  // 8KB chunks for non-tabular files
const MAX_CHUNKS_HASHED = 5000;               // sample beyond 5k chunks

async function sha256Hex(arrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", arrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Lightweight per-row hash — SHA-1 for speed across thousands of rows.
// Normalizes cell values (trimmed, lowercase, unified string/number representations).
async function hashRow(cells) {
  const normalized = cells
    .map((v) => {
      if (v === null || v === undefined) return "";
      const str = String(v).trim().toLowerCase();
      // Normalize simple numbers (e.g. "1.00" -> "1" or integer comparison)
      const num = Number(str);
      if (!isNaN(num) && str !== "") return String(num);
      return str;
    })
    .join("\u0001");
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Deliberately simple tabular parser (CSV/TSV) for structural and row-level hashing.
 */
function parseCsvText(text, delimiter = ",") {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { columns: [], rowCount: 0, columnStats: {}, rows: [] };

  const delim = delimiter || (lines[0].includes("\t") ? "\t" : ",");
  const columns = lines[0].split(delim).map((c) => c.trim().replace(/^["']|["']$/g, ""));
  const rows = lines.slice(1).map((l) => l.split(delim).map((c) => c.trim().replace(/^["']|["']$/g, "")));

  const columnStats = {};
  columns.forEach((col, idx) => {
    const values = rows.map((r) => r[idx]).filter((v) => v !== undefined && v !== "");
    const numeric = values.map(Number).filter((v) => !Number.isNaN(v));
    const isNumeric = numeric.length === values.length && values.length > 0;

    columnStats[col] = {
      inferredType: isNumeric ? "numeric" : "string",
      nullCount: rows.length - values.length,
      uniqueCount: new Set(values).size,
      ...(isNumeric ? { min: Math.min(...numeric), max: Math.max(...numeric) } : {}),
    };
  });

  return { columns, rowCount: rows.length, columnStats, rows };
}

function inferDateRangeFromCsv(columns, rows) {
  if (!columns || !rows || rows.length === 0) return { periodStart: null, periodEnd: null };
  const dateColIdx = columns.findIndex((c) => /date|time|timestamp|year|month|period|datetime/i.test(c));
  if (dateColIdx === -1) return { periodStart: null, periodEnd: null };

  const validDates = [];
  for (const r of rows) {
    const raw = r[dateColIdx];
    if (!raw) continue;
    const str = String(raw).trim();
    const timestamp = Date.parse(str);
    if (!isNaN(timestamp)) {
      validDates.push(new Date(timestamp));
    } else if (/^\d{4}$/.test(str)) {
      validDates.push(new Date(parseInt(str, 10), 0, 1));
    }
  }

  if (validDates.length === 0) return { periodStart: null, periodEnd: null };
  validDates.sort((a, b) => a.getTime() - b.getTime());
  const minDate = validDates[0].toISOString().split("T")[0];
  const maxDate = validDates[validDates.length - 1].toISOString().split("T")[0];
  return { periodStart: minDate, periodEnd: maxDate };
}

/**
 * Builds tabular content signature from rows.
 */
async function buildRowContentSignature(rows) {
  if (!rows || rows.length === 0) {
    return { type: "row-hashes", hashes: [], rowHashes: [], totalUnits: 0, sampled: false };
  }

  const sample =
    rows.length <= MAX_ROWS_HASHED
      ? rows
      : rows.filter((_, i) => i % Math.ceil(rows.length / MAX_ROWS_HASHED) === 0);

  const hashes = await Promise.all(sample.map(hashRow));
  return {
    type: "row-hashes",
    hashes,
    rowHashes: hashes, // alias for backwards compatibility
    totalUnits: rows.length,
    sampled: sample.length < rows.length,
  };
}

/**
 * Builds chunk-based content signature for non-tabular files (images, PDFs, media).
 */
async function buildChunkSignature(arrayBuffer) {
  const totalChunks = Math.ceil(arrayBuffer.byteLength / CHUNK_SIZE);
  if (totalChunks === 0) {
    return { type: "chunk-hashes", hashes: [], rowHashes: [], totalUnits: 0, sampled: false };
  }

  const chunkIndices = [];
  if (totalChunks <= MAX_CHUNKS_HASHED) {
    for (let i = 0; i < totalChunks; i++) chunkIndices.push(i);
  } else {
    const step = Math.ceil(totalChunks / MAX_CHUNKS_HASHED);
    for (let i = 0; i < totalChunks; i += step) chunkIndices.push(i);
  }

  const hashes = await Promise.all(
    chunkIndices.map(async (idx) => {
      const start = idx * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, arrayBuffer.byteLength);
      const slice = arrayBuffer.slice(start, end);
      const digest = await crypto.subtle.digest("SHA-1", slice);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    })
  );

  return {
    type: "chunk-hashes",
    hashes,
    rowHashes: hashes,
    totalUnits: totalChunks,
    sampled: chunkIndices.length < totalChunks,
  };
}

function detectIsWhatsApp(url = "", filename = "") {
  const isUrl = url.includes("web.whatsapp.com") || url.includes("whatsapp.net");
  const isName = /(IMG|VID|DOC|AUD|PTT)-\d{8}-WA\d+/i.test(filename) || /WA\d{4,}/i.test(filename);
  return isUrl || isName;
}

/**
 * Computes full fingerprint from an ArrayBuffer (used identically for web downloads,
 * local picked files, and directory re-scanned files).
 */
async function fingerprintBuffer(buffer, filename = "", mimeType = "", sourceUrl = "", extraMeta = {}) {
  const sizeBytes = buffer.byteLength;
  const sha256 = await sha256Hex(buffer);

  const nameToCheck = (filename || sourceUrl).toLowerCase();
  const contentType = (mimeType || "").toLowerCase();
  const isTabular =
    nameToCheck.endsWith(".csv") ||
    nameToCheck.endsWith(".tsv") ||
    contentType.includes("csv") ||
    contentType.includes("tab-separated");

  const isWhatsApp = detectIsWhatsApp(sourceUrl, filename);
  const inferredFileName = filename || sourceUrl.split("/").pop().split("?")[0] || (isWhatsApp ? "whatsapp_file" : "download");

  let schemaFingerprint = null;
  let contentSignature = null;
  let inferredPeriod = { periodStart: null, periodEnd: null };

  if (isTabular && sizeBytes <= MAX_CSV_PARSE_BYTES) {
    try {
      const text = new TextDecoder("utf-8").decode(buffer);
      const parsed = parseCsvText(text, nameToCheck.endsWith(".tsv") ? "\t" : ",");
      schemaFingerprint = {
        columns: parsed.columns,
        rowCount: parsed.rowCount,
        columnStats: parsed.columnStats,
      };
      contentSignature = await buildRowContentSignature(parsed.rows);
      inferredPeriod = inferDateRangeFromCsv(parsed.columns, parsed.rows);
    } catch {
      schemaFingerprint = null;
      contentSignature = await buildChunkSignature(buffer);
    }
  } else {
    // Non-tabular file (PDF, image, audio, WhatsApp media)
    contentSignature = await buildChunkSignature(buffer);
  }

  return {
    fileName: inferredFileName,
    filename: inferredFileName,
    fileSize: sizeBytes,
    sizeBytes,
    mimeType: contentType || (isTabular ? "text/csv" : "application/octet-stream"),
    downloadUrl: sourceUrl || "local-file",
    byteHash: sha256,
    sha256,
    structuralFingerprint: schemaFingerprint,
    schemaFingerprint,
    contentSignature,
    periodStart: extraMeta.periodStart || inferredPeriod.periodStart,
    periodEnd: extraMeta.periodEnd || inferredPeriod.periodEnd,
    spatialRegionName: extraMeta.spatialRegionName || null,
    isWhatsApp,
    source: extraMeta.source || (extraMeta.isManualIndex ? "manual_local_index" : isWhatsApp ? "whatsapp" : "web"),
    timestamp: extraMeta.lastModified || Date.now(),
    isManualIndex: Boolean(extraMeta.isManualIndex),
    isTrackedFolder: Boolean(extraMeta.isTrackedFolder),
    ...extraMeta,
  };
}


/**
 * Fingerprints a local file object (e.g. from <input type="file"> or File System Access API).
 */
async function fingerprintLocalFile(file, extraMeta = {}) {
  const buffer = await file.arrayBuffer();
  return await fingerprintBuffer(
    buffer,
    file.name,
    file.type || (file.name.endsWith(".csv") ? "text/csv" : "application/octet-stream"),
    "local-file",
    {
      isManualIndex: true,
      lastModified: file.lastModified || Date.now(),
      ...extraMeta,
    }
  );
}

/**
 * Fetches URL and produces byteHash, structuralFingerprint, and contentSignature in one pass.
 */
async function fetchAndFingerprint(url, filename = "") {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  let response;
  try {
    response = await fetch(url, { credentials: "include", signal: controller.signal });
  } catch (err1) {
    try {
      response = await fetch(url, { credentials: "omit", signal: controller.signal });
    } catch (err2) {
      response = await fetch(url, { signal: controller.signal });
    }
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response || !response.ok) {
    throw new Error(`Fetch failed: HTTP ${response?.status || "network error"}`);
  }
  const buffer = await response.arrayBuffer();
  const contentType = response.headers?.get("content-type") || "";

  return await fingerprintBuffer(buffer, filename, contentType, url);
}

/**
 * Standard DP Levenshtein distance calculation.
 */
function levenshtein(s1, s2) {
  const m = s1.length;
  const n = s2.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

/**
 * Real Levenshtein-based filename similarity (0.0 - 100.0%).
 * Accurately drops when filename is changed or renamed.
 */
function filenameSimilarity(nameA = "", nameB = "") {
  const normalize = (s) => (s || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")      // strip extension
    .replace(/[_\-\s]+/g, " ")        // normalize separators
    .trim();

  const a = normalize(nameA);
  const b = normalize(nameB);

  if (a === b && a.length > 0) return 100.0;
  if (a.length === 0 || b.length === 0) return 0.0;

  const distance = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  const sim = (1 - (distance / maxLen)) * 100;
  return Math.round(Math.max(0, Math.min(100, sim)) * 10) / 10;
}

/**
 * Multiset-based content similarity: counts exact row/chunk hash matches.
 * Accurately returns 98.0% when 2 out of 100 rows change.
 */
function contentSimilarity(sigA, sigB) {
  if (!sigA || !sigB) return { score: 0, matchedUnits: 0, totalUnitsSmaller: 0, totalUnitsLarger: 0, sampled: false };

  const typeA = sigA.type || (sigA.rowHashes ? "row-hashes" : null);
  const typeB = sigB.type || (sigB.rowHashes ? "row-hashes" : null);
  if (typeA && typeB && typeA !== typeB) {
    return { score: 0, matchedUnits: 0, totalUnitsSmaller: 0, totalUnitsLarger: 0, sampled: false };
  }

  const hashesA = sigA.hashes || sigA.rowHashes || [];
  const hashesB = sigB.hashes || sigB.rowHashes || [];
  if (hashesA.length === 0 || hashesB.length === 0) {
    return { score: 0, matchedUnits: 0, totalUnitsSmaller: 0, totalUnitsLarger: 0, sampled: false };
  }

  // Multiset frequency map from B
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

  const smallerLen = Math.min(hashesA.length, hashesB.length);
  const largerLen = Math.max(hashesA.length, hashesB.length);
  // Containment formula against smaller set
  const score = smallerLen > 0 ? (matched / smallerLen) * 100 : 0;
  const sampled = Boolean(sigA.sampled || sigB.sampled);

  return {
    score: Math.round(score * 10) / 10,
    matchedUnits: matched,
    totalUnitsSmaller: smallerLen,
    totalUnitsLarger: largerLen,
    sampled,
  };
}

/**
 * Compare schema fingerprints (column overlap, type compatibility)
 */
function compareSchema(schemaA, schemaB) {
  if (!schemaA?.columns?.length || !schemaB?.columns?.length) return 0;
  const setA = new Set(schemaA.columns.map((c) => c.toLowerCase()));
  const setB = new Set(schemaB.columns.map((c) => c.toLowerCase()));
  const intersection = [...setA].filter((c) => setB.has(c));
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return 0;

  const colOverlap = (intersection.length / union.size) * 100;
  return Math.round(colOverlap * 10) / 10;
}

/**
 * Blended scoring function.
 * Returns real computed float percentages for every signal.
 */
function scoreCandidate(newFingerprint, candidate) {
  const nameNew = newFingerprint.fileName || newFingerprint.filename || "";
  const nameCand = candidate.fileName || candidate.filename || candidate.title || candidate.original_filename || "";
  const metadataScore = filenameSimilarity(nameNew, nameCand);

  const isExactByteMatch = Boolean(
    newFingerprint.sha256 &&
    candidate.sha256 &&
    newFingerprint.sha256 === candidate.sha256
  );

  if (isExactByteMatch) {
    return {
      similarityScore: 100.0,
      contentScore: 100.0,
      schemaScore: 100.0,
      metadataScore,
      isExact: true,
      breakdown: { content: 100.0, schema: 100.0, metadata: metadataScore },
      sampled: false,
    };
  }

  const sigNew = newFingerprint.contentSignature;
  const sigCand = candidate.contentSignature;
  const contentResult = contentSimilarity(sigNew, sigCand);
  const contentScore = contentResult.score;

  const schemaNew = newFingerprint.structuralFingerprint || newFingerprint.schemaFingerprint;
  const schemaCand = candidate.structuralFingerprint || candidate.schemaFingerprint;
  const schemaScore = compareSchema(schemaNew, schemaCand);

  const hasContentSig = Boolean(
    (sigNew?.hashes?.length || sigNew?.rowHashes?.length) &&
    (sigCand?.hashes?.length || sigCand?.rowHashes?.length)
  );

  let finalScore = 0;
  if (hasContentSig) {
    // 60% content, 25% schema, 15% filename
    finalScore = (contentScore * 0.60) + (schemaScore * 0.25) + (metadataScore * 0.15);
  } else {
    // Content unverified: weight schema and metadata without inflating
    finalScore = (schemaScore * 0.25) + (metadataScore * 0.15);
  }

  const rounded = Math.round(Math.min(99.9, Math.max(0.0, finalScore)) * 10) / 10;
  return {
    similarityScore: rounded,
    contentScore,
    schemaScore,
    metadataScore,
    isExact: false,
    breakdown: {
      content: contentScore,
      schema: schemaScore,
      metadata: metadataScore,
    },
    sampled: contentResult.sampled,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    sha256Hex,
    hashRow,
    parseCsvText,
    buildRowContentSignature,
    buildChunkSignature,
    fingerprintBuffer,
    fingerprintLocalFile,
    fetchAndFingerprint,
    levenshtein,
    filenameSimilarity,
    contentSimilarity,
    compareSchema,
    scoreCandidate,
  };
}