const DB_NAME = "ddas_local_v1";
const STORE = "downloads";
const CONFIG_STORE = "config";
const DB_VERSION = 2;
const MAX_LOCAL_RECORDS = 2000; // LRU cap

// Resolve scoring functions across browser global scope and Node.js module scope
function getScoringHelpers() {
  let scoreFn = typeof scoreCandidate === "function" ? scoreCandidate : null;
  let filenameSimFn = typeof filenameSimilarity === "function" ? filenameSimilarity : null;
  let fpBufferFn = typeof fingerprintBuffer === "function" ? fingerprintBuffer : null;

  if ((!scoreFn || !filenameSimFn || !fpBufferFn) && typeof require !== "undefined") {
    try {
      const fp = require("./fingerprint");
      scoreFn = scoreFn || fp.scoreCandidate;
      filenameSimFn = filenameSimFn || fp.filenameSimilarity;
      fpBufferFn = fpBufferFn || fp.fingerprintBuffer;
    } catch {}
  }
  return { scoreCandidate: scoreFn, filenameSimilarity: filenameSimFn, fingerprintBuffer: fpBufferFn };
}

// In-memory fallback store for Node.js test environment or when IndexedDB is unavailable
const memoryRecords = new Map();
let memoryDirHandle = null;


function hasIndexedDB() {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

function openDB() {
  if (!hasIndexedDB()) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "sha256" });
        store.createIndex("sizeBytes", "sizeBytes");
        store.createIndex("downloadedAt", "downloadedAt");
        store.createIndex("mimeType", "mimeType");
      }
      if (!db.objectStoreNames.contains(CONFIG_STORE)) {
        db.createObjectStore(CONFIG_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Saves a completed, intercepted, or manually-indexed download record to IndexedDB.
 * Enforces LRU eviction if records exceed MAX_LOCAL_RECORDS.
 */
async function saveLocalRecord(record) {
  if (!record || !record.sha256) return false;

  const dataToSave = {
    id: record.sha256,
    sha256: record.sha256,
    byteHash: record.sha256,
    fileName: record.fileName || record.filename || "download",
    filename: record.fileName || record.filename || "download",
    fileSize: record.fileSize || record.sizeBytes || 0,
    sizeBytes: record.fileSize || record.sizeBytes || 0,
    mimeType: record.mimeType || "application/octet-stream",
    structuralFingerprint: record.structuralFingerprint || record.schemaFingerprint || null,
    schemaFingerprint: record.structuralFingerprint || record.schemaFingerprint || null,
    contentSignature: record.contentSignature || null,
    downloadPath: record.downloadPath || null,
    source: record.source || (record.isManualIndex ? "manual_local_index" : record.isWhatsApp ? "whatsapp" : "web"),
    downloadedAt: record.downloadedAt || record.timestamp || Date.now(),
    timestamp: record.downloadedAt || record.timestamp || Date.now(),
    isManualIndex: Boolean(record.isManualIndex),
    isTrackedFolder: Boolean(record.isTrackedFolder),
  };

  if (!hasIndexedDB()) {
    memoryRecords.set(dataToSave.sha256, dataToSave);
    return true;
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.put(dataToSave);

    tx.oncomplete = async () => {
      try {
        await enforceLRUCap();
      } catch {}
      resolve(true);
    };
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Updates an existing record (e.g. when modified on disk during directory re-scan).
 */
async function updateLocalRecord(oldSha256, newRecord) {
  if (oldSha256 && oldSha256 !== newRecord.sha256) {
    await deleteLocalRecord(oldSha256);
  }
  return await saveLocalRecord(newRecord);
}

/**
 * Deletes a record by its SHA-256 hash.
 */
async function deleteLocalRecord(sha256) {
  if (!sha256) return false;
  if (!hasIndexedDB()) {
    memoryRecords.delete(sha256);
    return true;
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(sha256);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Retrieves all stored local records.
 */
async function getAllLocalRecords() {
  if (!hasIndexedDB()) {
    return Array.from(memoryRecords.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const records = req.result || [];
      records.sort((a, b) => (b.downloadedAt || b.timestamp || 0) - (a.downloadedAt || a.timestamp || 0));
      resolve(records);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Keeps store bounded to MAX_LOCAL_RECORDS by pruning oldest downloads.
 */
async function enforceLRUCap() {
  if (!hasIndexedDB()) return;
  const db = await openDB();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const countReq = store.count();

  countReq.onsuccess = () => {
    if (countReq.result > MAX_LOCAL_RECORDS) {
      const overflow = countReq.result - MAX_LOCAL_RECORDS;
      const index = store.index("downloadedAt");
      const cursorReq = index.openCursor();
      let deleted = 0;

      cursorReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor && deleted < overflow) {
          cursor.delete();
          deleted++;
          cursor.continue();
        }
      };
    }
  };
}

async function findLocalExact(sha256) {
  if (!sha256) return null;
  if (!hasIndexedDB()) {
    return memoryRecords.get(sha256) || null;
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(sha256);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Filter candidates by size tolerance (±35%) and mime compatibility.
 */
async function getLocalCandidates(sizeBytes, mimeType = "") {
  const sizeMin = Math.floor((sizeBytes || 0) * 0.65);
  const sizeMax = Math.ceil((sizeBytes || 0) * 1.35);

  let all = [];
  if (!hasIndexedDB()) {
    all = Array.from(memoryRecords.values());
  } else {
    const db = await openDB();
    all = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  return all.filter((r) => {
    const candidateSize = r.sizeBytes || r.fileSize || 0;
    // If size is available on both, apply tolerance
    if (sizeBytes > 0 && candidateSize > 0) {
      const sizeMatch = candidateSize >= sizeMin && candidateSize <= sizeMax;
      if (!sizeMatch) return false;
    }

    if (mimeType && r.mimeType && mimeType.includes("/") && r.mimeType.includes("/")) {
      const typeA = mimeType.split("/")[0].toLowerCase();
      const typeB = r.mimeType.split("/")[0].toLowerCase();
      if (typeA !== typeB && typeA !== "application" && typeB !== "application") {
        return false;
      }
    }
    return true;
  });
}

/**
 * Finds local duplicate candidates, scores them, and returns a ranked list.
 * Live interception calls this exact same pipeline.
 */
async function findLocalDuplicates(newFingerprint) {
  if (!newFingerprint) return [];

  const { scoreCandidate: scoreCandidateFn, filenameSimilarity: filenameSimFn } = getScoringHelpers();

  // Exact match check first (SHA-256 byte match) — early exit optimization
  if (newFingerprint.sha256) {
    const exact = await findLocalExact(newFingerprint.sha256);
    if (exact) {
      const nameNew = newFingerprint.fileName || newFingerprint.filename || "";
      const nameExact = exact.fileName || exact.filename || "";
      const metaSim = typeof filenameSimFn === "function" ? filenameSimFn(nameNew, nameExact) : 100.0;

      console.log(`[DDAS Registry] Exact SHA-256 byte match found in device registry for: "${nameExact}"`);
      return [
        {
          record: exact,
          similarityScore: 100.0,
          relationshipType: "exact_duplicate",
          matchType: "exact_duplicate",
          isExact: true,
          breakdown: { content: 100.0, schema: 100.0, metadata: metaSim },
          matchSource: "device",
          sampled: false,
        },
      ];
    }
  }

  // When SHA-256 does NOT match, execute full content-signature & schema comparison pipeline
  const candidates = await getLocalCandidates(newFingerprint.sizeBytes, newFingerprint.mimeType);
  console.log(`[DDAS Registry] Comparing against ${candidates.length} local candidate record(s)...`);

  const scored = [];

  for (const candidate of candidates) {
    if (candidate.sha256 === newFingerprint.sha256) continue;

    let scoreResult;
    if (typeof scoreCandidateFn === "function") {
      scoreResult = scoreCandidateFn(newFingerprint, candidate);
    } else {
      scoreResult = {
        similarityScore: 0,
        contentScore: 0,
        schemaScore: 0,
        metadataScore: 0,
        isExact: false,
        breakdown: { content: 0, schema: 0, metadata: 0 },
        sampled: false,
      };
    }

    console.log(`[DDAS Candidate Comparison] vs "${candidate.fileName || candidate.filename}":`, {
      exactByteMatch: false,
      contentScore: `${scoreResult.contentScore}%`,
      schemaScore: `${scoreResult.schemaScore}%`,
      metadataScore: `${scoreResult.metadataScore}%`,
      finalBlendedScore: `${scoreResult.similarityScore}%`,
      breakdown: scoreResult.breakdown,
    });

    // Floor of 60.0% relevance to qualify as duplicate/near-duplicate alert
    if (scoreResult.similarityScore >= 60.0) {
      let relType = "related";
      if (scoreResult.isExact || scoreResult.similarityScore >= 100.0) {
        relType = "exact_duplicate";
      } else if (scoreResult.similarityScore >= 80.0) {
        relType = "near_duplicate";
      }

      scored.push({
        record: candidate,
        similarityScore: scoreResult.similarityScore,
        relationshipType: relType,
        matchType: relType,
        isExact: Boolean(scoreResult.isExact),
        breakdown: scoreResult.breakdown,
        matchSource: "device",
        sampled: scoreResult.sampled,
      });
    }
  }

  scored.sort((a, b) => b.similarityScore - a.similarityScore);
  return scored;
}

/**
 * Stores directory handle for Option B (File System Access API).
 */
async function saveDirectoryHandle(handle) {
  if (!hasIndexedDB()) {
    memoryDirHandle = handle;
    return true;
  }
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONFIG_STORE, "readwrite");
    tx.objectStore(CONFIG_STORE).put({ key: "downloads_dir_handle", handle, updatedAt: Date.now() });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Retrieves stored directory handle.
 */
async function getDirectoryHandle() {
  if (!hasIndexedDB()) return memoryDirHandle;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONFIG_STORE, "readonly");
    const req = tx.objectStore(CONFIG_STORE).get("downloads_dir_handle");
    req.onsuccess = () => resolve(req.result?.handle || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Option B: Re-scans previously tracked files in the granted directory.
 * If file content on disk has changed, updates signature and hash in IndexedDB in place.
 */
async function refreshTrackedFilesFromDirectory(dirHandle) {
  if (!dirHandle) return { scanned: 0, updated: 0, errors: [] };

  const { fingerprintBuffer: fpBufferFn } = getScoringHelpers();
  const records = await getAllLocalRecords();
  let updatedCount = 0;
  const errors = [];

  for (const record of records) {
    const filename = record.fileName || record.filename;
    if (!filename) continue;

    try {
      // Look up file handle in directory
      const fileHandle = await dirHandle.getFileHandle(filename, { create: false }).catch(() => null);
      if (!fileHandle) continue;

      const file = await fileHandle.getFile();
      const currentBuffer = await file.arrayBuffer();

      let currentFingerprint;
      if (typeof fpBufferFn === "function") {
        currentFingerprint = await fpBufferFn(
          currentBuffer,
          filename,
          file.type || record.mimeType,
          "tracked-directory",
          {
            isTrackedFolder: true,
            lastModified: file.lastModified,
            downloadPath: filename,
          }
        );
      } else {
        continue;
      }

      // Check if file has been modified since last indexed
      if (currentFingerprint.sha256 !== record.sha256) {
        console.log(`[DDAS Option B] Detected local edit in "${filename}": ${record.sha256.slice(0, 8)}... -> ${currentFingerprint.sha256.slice(0, 8)}...`);
        await updateLocalRecord(record.sha256, currentFingerprint);
        updatedCount++;
      }
    } catch (err) {
      errors.push({ filename, error: err.message });
    }
  }

  return { scanned: records.length, updated: updatedCount, errors };
}


/**
 * Clears on-device duplicate history from IndexedDB.
 */
async function clearLocalStore() {
  if (!hasIndexedDB()) {
    memoryRecords.clear();
    return true;
  }
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    openDB,
    saveLocalRecord,
    updateLocalRecord,
    deleteLocalRecord,
    getAllLocalRecords,
    findLocalExact,
    getLocalCandidates,
    findLocalDuplicates,
    saveDirectoryHandle,
    getDirectoryHandle,
    refreshTrackedFilesFromDirectory,
    clearLocalStore,
  };
}
