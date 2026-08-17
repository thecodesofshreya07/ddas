// On-device duplicate registry. Works fully offline, no auth required.
// Stage 1 of duplicate detection — always runs first, instantly and anonymously.

const DB_NAME = "ddas_local_v1";
const STORE = "downloads";
const DB_VERSION = 1;
const MAX_LOCAL_RECORDS = 2000; // LRU cap

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "sha256" });
        store.createIndex("sizeBytes", "sizeBytes");
        store.createIndex("downloadedAt", "downloadedAt");
        store.createIndex("mimeType", "mimeType");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Saves a completed or intercepted download record to IndexedDB.
 * Enforces LRU eviction if records exceed MAX_LOCAL_RECORDS.
 */
async function saveLocalRecord(record) {
  if (!record || !record.sha256) return false;
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);

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
      source: record.source || (record.isWhatsApp ? "whatsapp" : "web"),
      downloadedAt: record.downloadedAt || record.timestamp || Date.now(),
      timestamp: record.downloadedAt || record.timestamp || Date.now(),
    };

    store.put(dataToSave);

    tx.oncomplete = async () => {
      // Background LRU housekeeping
      try {
        await enforceLRUCap();
      } catch {}
      resolve(true);
    };
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Keeps store bounded to MAX_LOCAL_RECORDS by pruning oldest downloads.
 */
async function enforceLRUCap() {
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
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(sha256);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Filter candidates by size tolerance (±25%) and mime compatibility.
 */
async function getLocalCandidates(sizeBytes, mimeType = "") {
  const db = await openDB();
  const sizeMin = Math.floor((sizeBytes || 0) * 0.70);
  const sizeMax = Math.ceil((sizeBytes || 0) * 1.30);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const all = req.result || [];
      const filtered = all.filter((r) => {
        const sizeMatch = r.sizeBytes >= sizeMin && r.sizeBytes <= sizeMax;
        if (!sizeMatch) return false;
        if (mimeType && r.mimeType && mimeType.includes("/") && r.mimeType.includes("/")) {
          const typeA = mimeType.split("/")[0];
          const typeB = r.mimeType.split("/")[0];
          if (typeA !== typeB && typeA !== "application" && typeB !== "application") {
            return false;
          }
        }
        return true;
      });
      resolve(filtered);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Finds local duplicate candidates, scores them, and returns a ranked list.
 */
async function findLocalDuplicates(newFingerprint) {
  if (!newFingerprint) return [];

  // Exact match check first
  if (newFingerprint.sha256) {
    const exact = await findLocalExact(newFingerprint.sha256);
    if (exact) {
      return [
        {
          record: exact,
          similarityScore: 100,
          relationshipType: "exact_duplicate",
          matchType: "exact_duplicate",
          isExact: true,
          breakdown: { content: 100, schema: 100, metadata: 100 },
          matchSource: "device",
          sampled: false,
        },
      ];
    }
  }

  const candidates = await getLocalCandidates(newFingerprint.sizeBytes, newFingerprint.mimeType);
  const scored = [];

  for (const candidate of candidates) {
    if (candidate.sha256 === newFingerprint.sha256) continue;
    const scoreResult = scoreCandidate(newFingerprint, candidate);

    // Floor of 30% relevance to qualify as a candidate match
    if (scoreResult.similarityScore >= 30) {
      let relType = "distinct";
      if (scoreResult.isExact || (scoreResult.similarityScore === 100 && candidate.sha256 === newFingerprint.sha256)) {
        relType = "exact_duplicate";
      } else if (scoreResult.similarityScore >= 85) {
        relType = "near_duplicate";
      } else if (scoreResult.similarityScore >= 60) {
        relType = "related";
      } else {
        relType = "possible_match";
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
 * Clears on-device duplicate history.
 */
async function clearLocalStore() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}