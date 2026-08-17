// Runs on every page. Only acts on links that look like dataset downloads —
// everything else is left completely alone.

const TRACKED_EXTENSIONS = [".csv", ".json", ".pdf", ".xls", ".xlsx", ".tsv", ".parquet", ".zip"];

function looksLikeDatasetLink(link) {
  if (!link) return false;
  try {
    const downloadAttr = (link.getAttribute("download") || "").toLowerCase();
    if (TRACKED_EXTENSIONS.some((ext) => downloadAttr.endsWith(ext))) {
      return true;
    }
    const href = link.href || "";
    if (href.startsWith("javascript:") || href.startsWith("#")) {
      return false;
    }
    const url = new URL(href, window.location.href);
    const path = url.pathname.toLowerCase();
    return TRACKED_EXTENSIONS.some((ext) => path.endsWith(ext));
  } catch {
    return false;
  }
}

document.addEventListener(
  "click",
  (e) => {
    const link = e.target.closest("a");
    if (!link || !looksLikeDatasetLink(link)) return;

    e.preventDefault();
    e.stopPropagation();
    const downloadAttr = link.getAttribute("download");
    const filename = downloadAttr || link.href.split("/").pop().split("?")[0] || "dataset.csv";
    runCheck(link.href, filename);
  },
  true // capture phase, so this runs before the page's own click handlers
);

let activeOverlay = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "FETCH_AND_FINGERPRINT_TAB") {
    fetchAndFingerprint(message.url, message.filename)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // async response
  }

  if (message.type === "SHOW_DOWNLOAD_ALERT") {
    if (activeOverlay) {
      activeOverlay.close();
    }
    const overlay = showOverlay();
    activeOverlay = overlay;

    overlay.showAlert(message.result, {
      onUseExisting: () => {
        chrome.runtime.sendMessage({
          type: "ALERT_RESPONSE",
          downloadId: message.downloadId,
          action: "cancel",
        });
        overlay.close();
        activeOverlay = null;
      },
      onContinue: () => {
        chrome.runtime.sendMessage({
          type: "ALERT_RESPONSE",
          downloadId: message.downloadId,
          action: "continue",
        });
        overlay.close();
        activeOverlay = null;
      },
    });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "CLOSE_ALERT") {
    if (activeOverlay) {
      activeOverlay.close();
      activeOverlay = null;
    }
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

async function runCheck(url, filename) {
  const overlay = showOverlay();
  activeOverlay = overlay;
  overlay.setChecking(filename);

  try {
    const checkPromise = (async () => {
      let precomputedFp = null;
      try {
        precomputedFp = await fetchAndFingerprint(url, filename);
      } catch (e) {
        console.warn("[DDAS] in-page fingerprint failed:", e.message);
      }

      const result = await chrome.runtime.sendMessage({
        type: "CHECK_DOWNLOAD",
        url,
        filename,
        fingerprint: precomputedFp,
      });

      return { result, fpToSave: result?.fingerprint || precomputedFp };
    })();

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Check timeout")), 3500)
    );

    const { result, fpToSave } = await Promise.race([checkPromise, timeoutPromise]);

    if (!result || result.status === "disabled" || result.status === "error" || (result.status === "error" && result.failOpen)) {
      overlay.close();
      activeOverlay = null;
      chrome.runtime.sendMessage({ type: "PROCEED_DOWNLOAD", url, filename, fingerprint: fpToSave });
      return;
    }

    if (result.status === "auth_required") {
      overlay.showAuthRequired(() => {
        overlay.close();
        activeOverlay = null;
        chrome.runtime.sendMessage({ type: "PROCEED_DOWNLOAD", url, filename, fingerprint: fpToSave });
      });
      return;
    }

    if (result.status === "none") {
      overlay.showClear(() => {
        chrome.runtime.sendMessage({ type: "PROCEED_DOWNLOAD", url, filename, fingerprint: fpToSave });
      });
      activeOverlay = null;
      return;
    }

    if (result.status === "exact_duplicate" || result.status === "similar") {
      overlay.showAlert(result, {
        onUseExisting: () => {
          overlay.close();
          activeOverlay = null;
        },
        onContinue: () => {
          chrome.runtime.sendMessage({ type: "PROCEED_DOWNLOAD", url, filename, fingerprint: fpToSave });
          overlay.close();
          activeOverlay = null;
        },
      });
      return;
    }

    // Unrecognized status — fail open rather than silently blocking.
    overlay.close();
    activeOverlay = null;
    chrome.runtime.sendMessage({ type: "PROCEED_DOWNLOAD", url, filename, fingerprint: fpToSave });
  } catch (err) {
    console.warn("[DDAS] Check failed or timed out, proceeding with download:", err.message);
    overlay.close();
    activeOverlay = null;
    chrome.runtime.sendMessage({ type: "PROCEED_DOWNLOAD", url, filename });
  }
}

// ---------------------------------------------------------------------------
// Overlay UI — rendered in a shadow root so the host page's CSS can't break
// it (and vice versa).
// ---------------------------------------------------------------------------
function showOverlay() {
  const existingHost = document.getElementById("ddas-overlay-host");
  if (existingHost) {
    try { existingHost.remove(); } catch {}
  }
  const host = document.createElement("div");
  host.id = "ddas-overlay-host";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>${OVERLAY_CSS}</style>
    <div class="backdrop">
      <div class="modal" role="dialog" aria-live="polite">
        <div class="body"></div>
      </div>
    </div>
  `;

  const body = shadow.querySelector(".body");

  function close() {
    host.remove();
  }

  function setChecking(filename) {
    body.innerHTML = `
      <div class="checking">
        <div class="spinner"></div>
        <div class="checking-text">Checking <strong>${escapeHtml(filename)}</strong> against the DDAS registry…</div>
      </div>
    `;
  }

  function showAuthRequired(onDismiss) {
    body.innerHTML = `
      <div class="heading danger">Sign in required</div>
      <p class="desc">Sign in to the DDAS extension to enable duplicate-download checking.</p>
      <div class="actions">
        <button class="btn-secondary" id="ddas-dismiss">Download without checking</button>
      </div>
    `;
    shadow.getElementById("ddas-dismiss").onclick = onDismiss;
  }

  function showClear(onContinue) {
    body.innerHTML = `
      <div class="heading success">No duplicate found</div>
      <p class="desc">Registered as new. Starting download…</p>
    `;
    onContinue();
    setTimeout(close, 900);
  }

  function showAlert(result, { onUseExisting, onContinue }) {
    const score = Number(result.similarityScore ?? 0);
    const isExact = Boolean((result.status === "exact_duplicate" || result.isExact) && score >= 100);
    const title = isExact ? "Exact duplicate found" : "Near-duplicate dataset found";
    const existing = result.existing || {};
    const breakdown = result.breakdown || {};
    const isLocal = result.matchSource === "device";

    body.innerHTML = `
      <div class="heading ${isExact ? "danger" : "warning"}">${title}</div>
      <p class="desc">
        ${
          isExact
            ? isLocal
              ? "An identical file (100% byte match) is already stored locally on your device."
              : "An identical file (100% byte match) already exists in the institute registry."
            : isLocal
            ? `A file with ${score.toFixed(1)}% content similarity is already stored on your device.`
            : `A dataset with ${score.toFixed(1)}% similarity already exists in the registry.`
        }
      </p>
      <div class="existing">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <span class="badge ${isLocal ? "badge-local" : "badge-registry"}">
            ${isLocal ? "Found on this device" : "Institute Registry"}
          </span>
          ${result.sampled ? `<span style="font-size:10px; color:#64748B;">(Sampled)</span>` : ""}
        </div>
        <div class="existing-title">${escapeHtml(existing.title || "Untitled dataset")}</div>
        <div class="existing-meta">
          ${
            isLocal
              ? `<span>Saved: ${existing.uploadedAt ? new Date(existing.uploadedAt).toLocaleString() : "Previously"}</span>`
              : `<span>${escapeHtml(existing.ownerDepartment || "Cross-department")}</span> · <span>${escapeHtml(existing.classification || "internal")}</span>`
          }
        </div>
      </div>
      ${renderBreakdown(score, breakdown, result.relationshipType || (isExact ? "exact_duplicate" : "near_duplicate"), isLocal)}
      <div class="actions">
        <button class="btn-primary" id="ddas-use-existing">${isLocal ? "Keep existing file" : "Use existing dataset"}</button>
        <button class="btn-secondary" id="ddas-continue">Continue download</button>
      </div>
    `;

    shadow.getElementById("ddas-use-existing").onclick = () => {
      onUseExisting();
    };
    shadow.getElementById("ddas-continue").onclick = () => {
      onContinue();
    };
  }

  return { close, setChecking, showAuthRequired, showClear, showAlert };
}

function renderBreakdown(score, breakdown, relationshipType, isLocal) {
  const signals = [
    ["content", "Content overlap"],
    ["schema", "Structure"],
    ["metadata", "Filename / Title"],
    ["temporal", "Time period"],
    ["spatial", "Geography"],
    ["semantic", "Description"],
  ];
  const rows = signals
    .filter(([key]) => breakdown && breakdown[key] !== undefined && breakdown[key] !== null)
    .map(([key, label]) => {
      const v = Number(breakdown[key]) || 0;
      return `<tr><td>${label}</td><td class="num">${v.toFixed(1)}%</td></tr>`;
    })
    .join("");

  return `
    <div class="score-block">
      <div class="score-row">
        <span class="score-label">Match confidence</span>
        <span class="score-value">${score !== undefined ? Number(score).toFixed(1) : "100.0"}%</span>
      </div>
      ${relationshipType ? `<div class="badge">${escapeHtml(relationshipType.replace(/_/g, " "))}</div>` : ""}
      ${rows ? `<table class="breakdown-table">${rows}</table>` : ""}
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

const OVERLAY_CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: 'Inter', system-ui, sans-serif; }
  .backdrop {
    position: fixed; inset: 0; background: rgba(10,15,28,0.6);
    display: flex; align-items: center; justify-content: center;
    z-index: 2147483647;
  }
  .modal {
    background: #fff; border-radius: 4px; width: 360px; max-width: 90vw;
    padding: 20px; box-shadow: 0 12px 40px rgba(0,0,0,0.25);
  }
  .checking { display: flex; align-items: center; gap: 12px; }
  .spinner {
    width: 18px; height: 18px; border: 2px solid #DDE3EC; border-top-color: #14B8A6;
    border-radius: 50%; animation: ddas-spin 0.8s linear infinite; flex-shrink: 0;
  }
  @keyframes ddas-spin { to { transform: rotate(360deg); } }
  .checking-text { font-size: 13px; color: #1B2A45; line-height: 1.4; }
  .heading { font-size: 16px; font-weight: 600; margin-bottom: 6px; }
  .heading.danger { color: #BE123C; }
  .heading.warning { color: #D97706; }
  .heading.success { color: #0D9488; }
  .desc { font-size: 13px; color: #28395A; line-height: 1.5; margin: 0 0 12px; }
  .existing { background: #F5F7FA; border: 1px solid #DDE3EC; border-radius: 3px; padding: 10px 12px; margin-bottom: 12px; }
  .existing-title { font-size: 13px; font-weight: 500; color: #0A0F1C; }
  .existing-meta { font-size: 11px; color: #64748B; margin-top: 3px; display: flex; gap: 6px; font-family: 'JetBrains Mono', monospace; }
  .score-block { margin-bottom: 14px; }
  .score-row { display: flex; justify-content: space-between; align-items: baseline; }
  .score-label { font-size: 11px; text-transform: uppercase; color: #64748B; letter-spacing: 0.02em; }
  .score-value { font-family: 'JetBrains Mono', monospace; font-size: 20px; font-weight: 600; color: #0A0F1C; }
  .badge { display: inline-block; font-size: 10px; font-family: 'JetBrains Mono', monospace; text-transform: uppercase;
    background: #FEF3C7; color: #D97706; border: 1px solid #FDE68A; padding: 2px 6px; border-radius: 3px; margin: 4px 0 8px; }
  .badge-local { background: #E0F2FE; color: #0369A1; border-color: #BAE6FD; margin: 0; }
  .badge-registry { background: #EDE9FE; color: #6D28D9; border-color: #DDD6FE; margin: 0; }
  .breakdown-table { width: 100%; font-size: 12px; border-collapse: collapse; }
  .breakdown-table td { padding: 4px 0; border-top: 1px solid #ECEFF4; color: #1B2A45; }
  .breakdown-table td.num { text-align: right; font-family: 'JetBrains Mono', monospace; }
  .actions { display: flex; gap: 8px; margin-top: 4px; }
  .btn-primary, .btn-secondary {
    flex: 1; font-size: 13px; font-weight: 500; padding: 9px 12px; border-radius: 3px;
    cursor: pointer; border: none; transition: opacity 0.15s;
  }
  .btn-primary { background: #14B8A6; color: #0A0F1C; }
  .btn-secondary { background: #fff; color: #1B2A45; border: 1px solid #DDE3EC; }
  .btn-primary:hover, .btn-secondary:hover { opacity: 0.85; }
`;
