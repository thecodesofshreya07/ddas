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
  const lowerName = filename.toLowerCase();
  if (TRACKED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
    return true;
  }
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (TRACKED_EXTENSIONS.some((ext) => pathname.endsWith(ext))) {
      return true;
    }
  } catch {
    // Ignore invalid or blob URL parsing
  }
  if (mime && TRACKED_MIMES.some((m) => mime.toLowerCase().includes(m))) {
    return true;
  }
  // WhatsApp downloads are often blob: or named without standard extension initially
  if (url.includes("web.whatsapp.com") || /(IMG|VID|DOC|AUD|PTT)-\d{8}-WA\d+/i.test(filename)) {
    return true;
  }
  return false;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CHECK_DOWNLOAD") {
    handleCheckDownload(message.url, message.filename, message.fingerprint).then(sendResponse);
    return true;
  }
  if (message.type === "PROCEED_DOWNLOAD") {
    handleProceedDownload(message.url, message.filename, message.fingerprint);
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === "GET_AUTH") {
    getAuth().then(sendResponse);
    return true;
  }
  if (message.type === "ALERT_RESPONSE") {
    const { downloadId, action } = message;
    const pending = pendingDecisions.get(downloadId);
    if (pending) {
      pendingDecisions.delete(downloadId);
      if (action === "cancel") {
        chrome.downloads.cancel(downloadId, () => {
          if (chrome.runtime.lastError) {
            console.warn("[DDAS] Error cancelling download:", chrome.runtime.lastError.message);
          }
        });
      } else {
        allowedDownloadIds.add(downloadId);
        if (pending.fingerprint) {
          saveLocalRecord(pending.fingerprint).catch(() => {});
        }
        pending.suggest();
      }
    }
    sendResponse({ ok: true });
    return false;
  }
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

      // Step 1: Compute hash and content signature
      let fingerprint = null;
      try {
        fingerprint = await fetchAndFingerprint(item.url, item.filename);
      } catch (fetchErr) {
        console.warn("[DDAS] Worker fetch failed, delegating to tab context:", fetchErr.message);
        fingerprint = await fetchFingerprintFromTab(item);
      }

      if (!fingerprint) {
        console.warn("[DDAS] Could not fingerprint download, failing open:", item.filename);
        suggest();
        return;
      }

      // Step 2: Run Path A (Local On-Device Check) & Path B (Server Check)
      const merged = await runDualPathCheck(fingerprint, item.filename, item.url);
      const score = Number(merged.similarityScore) || 0;

      // Step 3: If duplicate or near-duplicate found (score >= 60.0), alert user!
      if (score >= 60.0 && (merged.status === "exact_duplicate" || merged.status === "similar" || merged.status === "related")) {
        pendingDecisions.set(item.id, { suggest, item, fingerprint });

        const shownInTab = await showAlertInTab(item, merged, fingerprint);
        if (!shownInTab) {
          // Fallback to system desktop notification if no tab DOM is available
          chrome.notifications.create(`ddas-dup-${item.id}`, {
            type: "basic",
            iconUrl: "icons/icon-128.png",
            title: merged.status === "exact_duplicate" ? "DDAS: Duplicate Download Detected" : "DDAS: Near-Duplicate Dataset Found",
            message: `"${item.filename}" is already ${merged.matchSource === "device" ? "on this device" : "in the institute registry"} (${score.toFixed(1)}% match).`,
          });
          setTimeout(() => {
            if (pendingDecisions.has(item.id)) {
              const p = pendingDecisions.get(item.id);
              pendingDecisions.delete(item.id);
              if (p?.fingerprint) saveLocalRecord(p.fingerprint).catch(() => {});
              suggest();
            }
          }, 25000);
        }
        return;
      }

      // If no duplicate found or below threshold, record locally and allow download immediately
      saveLocalRecord(fingerprint).catch(() => {});
      suggest();
    } catch (err) {
      console.warn("[DDAS] Global interception check failed, failing open:", err.message);
      suggest();
    }
  })();

  return true; // Keep suggest channel open for async determination
});

/**
 * Runs Path A (Device check) and Path B (Registry check) in parallel/orchestration.
 */
async function runDualPathCheck(fingerprint, filename, url) {
  // ---- Path A: local on-device check. Always runs, zero network, no auth needed. ----
  const localMatches = await findLocalDuplicates(fingerprint).catch(() => []);
  let localResult = { status: "none", matchSource: "device" };
  if (localMatches.length > 0) {
    const top = localMatches[0];
    localResult = {
      status: top.isExact || top.relationshipType === "exact_duplicate" ? "exact_duplicate" : "similar",
      matchSource: "device",
      similarityScore: top.similarityScore,
      relationshipType: top.relationshipType,
      isExact: Boolean(top.isExact),
      breakdown: top.breakdown,
      sampled: top.sampled,
      existing: {
        title: top.record.fileName || top.record.filename || "Local file",
        fileName: top.record.fileName || top.record.filename || "Local file",
        uploadedAt: new Date(top.record.downloadedAt || top.record.timestamp || Date.now()).toISOString(),
      },
    };
  }

  // ---- Path B: server/institute registry check (only if online and authenticated) ----
  const { token } = await getAuth();
  let serverResult = null;
  if (token && navigator.onLine !== false) {
    serverResult = await checkServer(fingerprint, filename, url, token).catch((err) => {
      console.warn("[DDAS] server check failed, using local result only:", err.message);
      return null;
    });
  }

  const merged = mergeResults(localResult, serverResult);
  return { ...merged, fingerprint };
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
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return activeTab ? activeTab.id : null;
  } catch {
    return null;
  }
}

async function ensureTabInjected(tabId) {
  try {
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

async function fetchFingerprintFromTab(item) {
  const tabId = item.tabId > 0 ? item.tabId : await getActiveTabId();
  if (!tabId) return null;

  try {
    const resp = await chrome.tabs.sendMessage(tabId, {
      type: "FETCH_AND_FINGERPRINT_TAB",
      url: item.url,
      filename: item.filename,
    });
    if (resp && resp.ok && resp.data) {
      return resp.data;
    }
  } catch (err) {
    // If not injected or broken connection, inject scripts into tab and retry
    try {
      const injected = await ensureTabInjected(tabId);
      if (injected) {
        const resp = await chrome.tabs.sendMessage(tabId, {
          type: "FETCH_AND_FINGERPRINT_TAB",
          url: item.url,
          filename: item.filename,
        });
        if (resp && resp.ok && resp.data) {
          return resp.data;
        }
      }
    } catch (retryErr) {
      console.warn("[DDAS] Tab fingerprint retry failed:", retryErr.message);
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

  try {
    const resp = await chrome.tabs.sendMessage(tabId, payload);
    if (resp && resp.ok) return true;
  } catch (err) {
    try {
      const injected = await ensureTabInjected(tabId);
      if (injected) {
        const resp = await chrome.tabs.sendMessage(tabId, payload);
        if (resp && resp.ok) return true;
      }
    } catch (retryErr) {
      console.warn("[DDAS] Could not send alert to tab after injection:", retryErr.message);
    }
  }
  return false;
}