importScripts("config.js", "fingerprint.js", "localStore.js");

const TRACKED_EXTENSIONS = [".csv", ".json", ".pdf", ".xls", ".xlsx", ".tsv", ".parquet", ".jpg", ".jpeg", ".png", ".zip"];
const TRACKED_MIMES = [
  "text/csv",
  "application/json",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/tab-separated-values",
  "image/jpeg",
  "image/png",
];

const allowedDownloadIds = new Set();
const pendingDecisions = new Map(); // downloadId -> { suggest, item, fingerprint }

function isTrackedFile(filename = "", mime = "", url = "") {
  const lowerName = (filename || "").toLowerCase();
  const lowerUrl = (url || "").toLowerCase();
  const lowerMime = (mime || "").toLowerCase();

  // 1. Check if filename has tracked dataset or media extension
  if (TRACKED_EXTENSIONS.some((ext) => lowerName.includes(ext))) {
    return true;
  }

  // 2. Check if URL contains tracked extension (including query parameters)
  if (TRACKED_EXTENSIONS.some((ext) => lowerUrl.includes(ext))) {
    return true;
  }

  // 3. Check MIME types
  if (TRACKED_MIMES.some((m) => lowerMime.includes(m))) {
    return true;
  }

  // 4. WhatsApp or messaging downloads
  if (lowerUrl.includes("web.whatsapp.com") || /(IMG|VID|DOC|AUD|PTT)-\d{8}-WA\d+/i.test(filename)) {
    return true;
  }

  // 5. Generic dataset/table downloads
  if (lowerMime.includes("octet-stream") || lowerMime.includes("text/plain")) {
    if (lowerUrl.includes("dataset") || lowerUrl.includes("download") || lowerUrl.includes("export") || lowerUrl.includes("data") || lowerUrl.includes("csv")) {
      return true;
    }
  }

  return false;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CHECK_DOWNLOAD") {
    handleCheckDownload(message.url, message.filename, message.fingerprint)
      .then((res) => sendResponse(res || { status: "none" }))
      .catch((err) => sendResponse({ status: "error", error: err.message }));
    return true;
  }
  if (message.type === "PROCEED_DOWNLOAD") {
    handleProceedDownload(message.url, message.filename, message.fingerprint);
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === "GET_AUTH") {
    getAuth()
      .then((auth) => sendResponse(auth || {}))
      .catch(() => sendResponse({}));
    return true;
  }
  if (message.type === "ALERT_RESPONSE") {
    const { downloadId, action } = message;
    const pending = pendingDecisions.get(downloadId);
    if (pending) {
      pendingDecisions.delete(downloadId);
      if (action === "cancel") {
        console.log(`[DDAS Interceptor] User chose to cancel duplicate download ${downloadId}`);
        chrome.downloads.cancel(downloadId, () => {
          if (chrome.runtime.lastError) {
            // safely consume lastError
          }
        });
      } else if (action === "continue") {
        console.log(`[DDAS Interceptor] User chose to continue download ${downloadId}`);
        allowedDownloadIds.add(downloadId);
        if (pending.fingerprint) {
          saveLocalRecord(pending.fingerprint).catch(() => {});
          registerDownloadOnServer(pending.fingerprint, pending.item?.filename, pending.item?.url).catch(() => {});
        }
        pending.suggest();
      }
    }
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === "INDEX_LOCAL_FILE") {
    saveLocalRecord(message.fingerprint)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (message.type === "GET_LOCAL_RECORDS") {
    getAllLocalRecords()
      .then((records) => sendResponse({ ok: true, records }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (message.type === "DELETE_LOCAL_RECORD") {
    deleteLocalRecord(message.sha256)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (message.type === "CLEAR_LOCAL_CACHE") {
    clearLocalStore()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  sendResponse({ ok: false, error: "Unknown message type" });
  return false;
});


// Clean up state when downloads finish or are interrupted
chrome.downloads.onChanged.addListener((change) => {
  if (change.state && (change.state.current === "interrupted" || change.state.current === "complete")) {
    pendingDecisions.delete(change.id);
    allowedDownloadIds.delete(change.id);
  }
});

/**
 * Global download interceptor — catches ALL downloads in the browser:
 * Direct clicks, WhatsApp Web, Blob URLs, JavaScript triggers.
 *
 * Runs the EXACT same pipeline as the test bench:
 * fetchAndFingerprint -> findLocalDuplicates -> contentSimilarity -> scoreCandidate
 */
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  // If download was initiated by DDAS extension or already explicitly allowed, proceed
  if (item.byExtensionId === chrome.runtime.id || allowedDownloadIds.has(item.id)) {
    allowedDownloadIds.delete(item.id);
    suggest();
    return false;
  }

  // Only intercept tracked dataset formats and media
  if (!isTrackedFile(item.filename, item.mime, item.url)) {
    suggest();
    return false;
  }

  (async () => {
    try {
      const enabled = await isInterceptionEnabled();
      if (!enabled) {
        suggest();
        return;
      }

      console.log(`[DDAS Interceptor] >>> Live download intercepted: "${item.filename}" (${item.mime || "unknown mime"})`);

      // Step 1: Compute hash and content signature (tab context first for cookies/session, then worker)
      let fingerprint = null;
      try {
        fingerprint = await fetchFingerprintFromTab(item);
      } catch (tabErr) {
        console.warn("[DDAS Interceptor] Tab context fetch failed:", tabErr.message);
      }

      if (!fingerprint) {
        try {
          fingerprint = await fetchAndFingerprint(item.url, item.filename);
        } catch (workerErr) {
          console.warn("[DDAS Interceptor] Worker fetch failed:", workerErr.message);
        }
      }

      if (!fingerprint) {
        console.warn("[DDAS Interceptor] Could not fingerprint download, failing open:", item.filename);
        suggest();
        return;
      }

      // Step 2: Run Path A (Local On-Device Check) & Path B (Server Check)
      const merged = await runDualPathCheck(fingerprint, item.filename, item.url);
      const score = Number(merged.similarityScore) || 0;

      console.log(`[DDAS Interceptor] Scoring summary for "${item.filename}":`, {
        byteHashMatch: Boolean(merged.isExact),
        contentScore: `${merged.breakdown?.content ?? 0}%`,
        structuralScore: `${merged.breakdown?.schema ?? 0}%`,
        filenameScore: `${merged.breakdown?.metadata ?? 0}%`,
        finalBlendedScore: `${score}%`,
        matchSource: merged.matchSource,
        existingMatch: merged.existing?.fileName || "None",
        relationshipType: merged.relationshipType || merged.status,
      });

      // Step 3: If duplicate or near-duplicate found (per existing engine threshold), alert user!
      if (merged.status && merged.status !== "none") {
        console.log(`[DDAS Interceptor] Duplicate/Near-Duplicate found (${score}%) — pausing download for user decision modal.`);
        pendingDecisions.set(item.id, { suggest, item, fingerprint });

        const shownInTab = await showAlertInTab(item, merged, fingerprint);
        if (!shownInTab) {
          // Fallback to system desktop notification if no tab DOM is available
          chrome.notifications.create(`ddas-dup-${item.id}`, {
            type: "basic",
            iconUrl: "icons/icon-128.png",
            title: merged.status === "exact_duplicate" ? "DDAS: Duplicate Download Detected" : "DDAS: Near-Duplicate Dataset Found",
            message: `"${item.filename}" already exists in the institute registry (${score.toFixed(1)}% match). Open DDAS to review.`,
          });
        }
        return;
      }

      // If no duplicate found, record locally and register on server, then allow download
      console.log(`[DDAS Interceptor] No duplicate found. Saving to device registry & central server, proceeding.`);

      saveLocalRecord(fingerprint).catch(() => {});
      registerDownloadOnServer(fingerprint, item.filename, item.url).catch(() => {});
      suggest();
    } catch (err) {
      console.warn("[DDAS Interceptor] Global interception check failed, failing open:", err.message);
      suggest();
    }
  })();

  return true; // Keep suggest channel open for async determination
});

/**
 * Auto-registers completed download on central institute server (Gap 1).
 */
async function registerDownloadOnServer(fingerprint, filename, url) {
  try {
    const { token } = await getAuth();
    if (!token || navigator.onLine === false) return;

    const apiBase = await getApiBase();
    await fetch(`${apiBase}/api/datasets/register-download`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        sha256: fingerprint.sha256,
        sizeBytes: fingerprint.sizeBytes,
        filename: filename || fingerprint.fileName || "downloaded_file.csv",
        title: filename || fingerprint.fileName,
        schemaFingerprint: fingerprint.schemaFingerprint,
        contentSignature: fingerprint.contentSignature,
        sourceUrl: url || fingerprint.downloadUrl,
        periodStart: fingerprint.periodStart || null,
        periodEnd: fingerprint.periodEnd || null,
        spatialRegionName: fingerprint.spatialRegionName || null,
      }),
    });
  } catch (err) {
    console.warn("[DDAS] Server auto-registration failed (non-fatal):", err.message);
  }
}

/**
 * Section 2: Path B (Central Registry API) is primary and authoritative.
 * Path A (Local IndexedDB) is a fallback only when the registry is unreachable.
 */
async function runDualPathCheck(fingerprint, filename, url) {
  const { token } = await getAuth();
  let serverResult = null;

  // ---- 1. Primary: Central Registry API Check ----
  if (token && navigator.onLine !== false) {
    serverResult = await checkServer(fingerprint, filename, url, token).catch((err) => {
      console.warn("[DDAS] Central registry check unreachable/error:", err.message);
      return null;
    });
  }

  if (serverResult && serverResult.status !== "error") {
    return { ...serverResult, matchSource: "registry", fingerprint };
  }

  // ---- 2. Fallback Only: Local IndexedDB (When offline or server unreachable) ----
  console.log("[DDAS] Central registry unavailable, checking local fallback store...");
  const localMatches = await findLocalDuplicates(fingerprint).catch((err) => {
    console.warn("[DDAS] Local fallback search error:", err);
    return [];
  });

  if (localMatches.length > 0) {
    const top = localMatches[0];
    return {
      status: top.isExact || top.relationshipType === "exact_duplicate" ? "exact_duplicate" : "similar",
      matchSource: "registry",
      isFallback: true,
      similarityScore: top.similarityScore,
      relationshipType: top.relationshipType,
      isExact: Boolean(top.isExact),
      breakdown: top.breakdown,
      sampled: top.sampled,
      existing: {
        title: top.record.fileName || top.record.filename || "Registry Dataset",
        fileName: top.record.fileName || top.record.filename || "Registry Dataset",
        uploadedAt: new Date(top.record.downloadedAt || top.record.timestamp || Date.now()).toISOString(),
        downloaderUsername: top.record.username || "Local User",
        downloadLocation: "Institute Registry",
        downloadedAt: new Date(top.record.downloadedAt || top.record.timestamp || Date.now()).toISOString(),
        periodStart: top.record.periodStart || null,
        periodEnd: top.record.periodEnd || null,
        spatialRegionName: top.record.spatialRegionName || null,
      },
      fingerprint,
    };
  }

  return { status: "none", similarityScore: 0, matchSource: "registry", fingerprint };
}



async function handleCheckDownload(url, filename, precomputedFingerprint = null) {
  const enabled = await isInterceptionEnabled();
  if (!enabled) return { status: "disabled" };

  let fingerprint = precomputedFingerprint;
  if (!fingerprint) {
    try {
      fingerprint = await fetchAndFingerprint(url, filename);
    } catch (err) {
      fingerprint = await fetchFingerprintFromTab({ url, filename });
    }
  }

  if (!fingerprint) {
    console.warn("[DDAS] fingerprint fetch failed, allowing download");
    return { status: "error", error: "Could not fingerprint file", failOpen: true };
  }

  return await runDualPathCheck(fingerprint, filename, url);
}

async function checkServer(fingerprint, filename, url, token) {
  const apiBase = await getApiBase();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);

  try {
    const res = await fetch(`${apiBase}/api/datasets/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      signal: controller.signal,
      body: JSON.stringify({
        sha256: fingerprint.sha256,
        sizeBytes: fingerprint.sizeBytes,
        filename,
        schemaFingerprint: fingerprint.schemaFingerprint,
        contentSignature: fingerprint.contentSignature,
        sourceUrl: url,
        periodStart: fingerprint.periodStart || null,
        periodEnd: fingerprint.periodEnd || null,
        spatialRegionName: fingerprint.spatialRegionName || null,
      }),
    });

    if (res.status === 401) {
      await clearAuth();
      return null;
    }
    if (!res.ok) return null;

    const data = await res.json();
    return { ...data, matchSource: "registry" };
  } catch (err) {
    console.warn("[DDAS] Server check network timeout/error:", err.message);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function mergeResults(local, server) {

  if (local.status === "exact_duplicate") return local;
  if (!server || server.status === "none" || !server.similarityScore || server.similarityScore < 60.0) return local;
  if (local.status === "none") return server;

  const localScore = Number(local.similarityScore) || 0;
  const serverScore = Number(server.similarityScore) || 0;
  return serverScore >= localScore ? server : local;
}

async function handleProceedDownload(url, filename, fingerprint) {
  try {
    chrome.downloads.download({ url, filename: filename || undefined }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.warn("[DDAS] download trigger error:", chrome.runtime.lastError.message);
        return;
      }
      if (downloadId) {
        allowedDownloadIds.add(downloadId);
      }
    });
  } catch (err) {
    console.warn("[DDAS] failed to trigger proceed download:", err.message);
  }

  if (fingerprint?.sha256) {
    saveLocalRecord(fingerprint).catch((err) => console.warn("[DDAS] failed to save local record:", err.message));
  }
}

async function getActiveTabId() {
  try {
    let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab) {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    }
    if (!tab) {
      const tabs = await chrome.tabs.query({ active: true });
      tab = tabs[0];
    }
    return tab ? tab.id : null;
  } catch {
    return null;
  }
}

async function ensureTabInjected(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://") || tab.url.startsWith("edge://") || tab.url.startsWith("about:")) {
      return false;
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(window.__DDAS_CONTENT_SCRIPT_INITIALIZED__),
    });
    if (results && results[0]?.result) {
      return true;
    }
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["fingerprint.js", "content.js"],
    });
    return true;
  } catch (err) {
    console.warn("[DDAS] Script injection failed:", err.message);
    return false;
  }
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(response);
        }
      });
    } catch {
      resolve(null);
    }
  });
}

async function fetchFingerprintFromTab(item) {
  const tabId = item.tabId > 0 ? item.tabId : await getActiveTabId();
  if (!tabId) return null;

  let resp = await sendMessageToTab(tabId, {
    type: "FETCH_AND_FINGERPRINT_TAB",
    url: item.url,
    filename: item.filename,
  });

  if (resp && resp.ok && resp.data) {
    return resp.data;
  }

  // If not injected or tab was refreshing, ensure scripts are injected and retry once
  const injected = await ensureTabInjected(tabId);
  if (injected) {
    resp = await sendMessageToTab(tabId, {
      type: "FETCH_AND_FINGERPRINT_TAB",
      url: item.url,
      filename: item.filename,
    });
    if (resp && resp.ok && resp.data) {
      return resp.data;
    }
  }

  return null;
}

async function showAlertInTab(item, checkResult, fingerprint) {
  const tabId = item.tabId > 0 ? item.tabId : await getActiveTabId();
  if (!tabId) return false;

  const payload = {
    type: "SHOW_DOWNLOAD_ALERT",
    downloadId: item.id,
    result: { ...checkResult, sha256: fingerprint.sha256 },
    filename: item.filename,
    url: item.url,
  };

  let resp = await sendMessageToTab(tabId, payload);
  if (resp && resp.ok) return true;

  const injected = await ensureTabInjected(tabId);
  if (injected) {
    resp = await sendMessageToTab(tabId, payload);
    if (resp && resp.ok) return true;
  }

  return false;
}