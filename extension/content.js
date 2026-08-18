// DDAS Content Script — renders isolated Shadow DOM alert modals and provides tab-context fingerprinting.

(function () {
  if (typeof window !== "undefined" && window.__DDAS_CONTENT_SCRIPT_INITIALIZED__) {
    return;
  }
  if (typeof window !== "undefined") {
    window.__DDAS_CONTENT_SCRIPT_INITIALIZED__ = true;
  }

  let activeOverlay = null;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "FETCH_AND_FINGERPRINT_TAB") {
      if (typeof fetchAndFingerprint !== "function") {
        sendResponse({ ok: false, error: "fetchAndFingerprint is not available in page context" });
        return false;
      }
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

// ---------------------------------------------------------------------------
// Overlay UI — rendered in a shadow root so the host page's CSS can't break
// it (and vice versa).
// ---------------------------------------------------------------------------
function showOverlay() {
  const existingHost = document.getElementById("ddas-overlay-host");
  if (existingHost) {
    try {
      existingHost.remove();
    } catch {}
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
    try {
      if (host && host.parentNode) {
        host.parentNode.removeChild(host);
      }
    } catch {}
    if (activeOverlay && activeOverlay.host === host) {
      activeOverlay = null;
    }
  }

  function showAlert(result, { onUseExisting, onContinue }) {
    if (!result || !result.status || result.status === "none") {
      onContinue();
      return;
    }

    const score = Number(result.similarityScore) || 0;


    const isExact = Boolean((result.status === "exact_duplicate" || result.isExact) && score >= 100.0);
    const title = isExact
      ? "Exact duplicate found"
      : score >= 80.0
      ? "Near-duplicate dataset found"
      : "Related dataset found";

    const existing = result.existing || {};
    const existingFileName = existing.fileName || existing.title || "Stored file";
    const breakdown = result.breakdown || {};
    const relType = result.relationshipType || (isExact ? "exact_duplicate" : score >= 80.0 ? "near_duplicate" : "related");
    const hasAccess = existing.hasAccess !== false;

    const periodText = existing.periodStart && existing.periodEnd
      ? `${existing.periodStart} to ${existing.periodEnd}`
      : existing.periodStart || existing.periodEnd || "";
    const regionText = existing.spatialRegionName || "";
    const coordsText = (existing.spatialMinLat !== null && existing.spatialMinLat !== undefined)
      ? `[${existing.spatialMinLat}°, ${existing.spatialMinLng}° to ${existing.spatialMaxLat}°, ${existing.spatialMaxLng}°]`
      : "";
    const downloader = existing.downloaderUsername || "User";
    const location = existing.downloadLocation || (existing.ownerDepartment ? `${existing.ownerDepartment} / Central Registry` : "Institute Registry");
    const timestamp = existing.downloadedAt || existing.uploadedAt ? new Date(existing.downloadedAt || existing.uploadedAt).toLocaleString() : "";
    const domainText = existing.domain || "";
    const formatText = (existing.format || existingFileName.split(".").pop() || "").toUpperCase();
    const sizeText = existing.sizeBytes ? `${(existing.sizeBytes / 1024).toFixed(1)} KB` : "";
    const columnsText = Array.isArray(existing.columns) && existing.columns.length > 0
      ? `${existing.columns.length} columns: ${existing.columns.slice(0, 4).join(", ")}${existing.columns.length > 4 ? "…" : ""}`
      : "";
    const rowCountText = existing.rowCount ? `${Number(existing.rowCount).toLocaleString()} rows` : "";

    body.innerHTML = `
      <div class="heading ${isExact ? "danger" : "warning"}">${title}</div>
      <p class="desc">
        ${
          isExact
            ? "An identical file (100% byte match) already exists in the institute registry."
            : `A dataset with ${score.toFixed(1)}% similarity already exists in the registry.`
        }
      </p>
      <div class="existing">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span class="badge ${hasAccess ? "badge-registry" : "badge-restricted"}">
            ${hasAccess ? "Institute Registry" : "Restricted Registry"}
          </span>
          ${result.sampled ? `<span style="font-size:10px; color:#64748B;">(Sampled)</span>` : ""}
        </div>
        <div class="existing-title">${escapeHtml(existingFileName)}</div>
        <div class="existing-meta">
          <span>${escapeHtml(existing.ownerDepartment || "Registry")}</span> · <span>${escapeHtml(domainText || "General")}</span> · <span>${escapeHtml(existing.classification || "internal")}</span>
        </div>

        <!-- Comprehensive Dataset Properties Notification -->
        <div class="existing-attrs">
          ${periodText ? `<div>📅 <strong>Period:</strong> <span style="color:#0F172A; font-weight:500;">${escapeHtml(periodText)}</span></div>` : ""}
          ${regionText ? `<div>📍 <strong>Spatial Domain:</strong> <span style="color:#0F172A; font-weight:500;">${escapeHtml(regionText)}</span> ${coordsText ? `<small style="color:#64748B;">${escapeHtml(coordsText)}</small>` : ""}</div>` : ""}
          ${(columnsText || rowCountText) ? `<div>📊 <strong>Attributes:</strong> <span style="color:#0F172A;">${escapeHtml([rowCountText, columnsText].filter(Boolean).join(" · "))}</span></div>` : ""}
          ${(formatText || sizeText) ? `<div>📁 <strong>Format & Size:</strong> <span style="color:#0F172A;">${escapeHtml([formatText, sizeText].filter(Boolean).join(" · "))}</span></div>` : ""}
        </div>

        ${
          hasAccess
            ? `
            <div style="margin-top:8px; padding:8px 10px; background:#131E33; border:1px solid #1B2A45; border-radius:3px; font-size:11px; color:#94A3B8; display:flex; flex-direction:column; gap:3px;">
              <div>👤 Custodian / Downloader: <strong style="color:#F5F7FA;">${escapeHtml(downloader)}</strong></div>
              <div>📂 Storage Location: <strong style="color:#38BDF8;">${escapeHtml(location)}</strong></div>
              ${timestamp ? `<div>🕒 Registered At: <span style="font-family:'JetBrains Mono',monospace; color:#E2E8F0;">${escapeHtml(timestamp)}</span></div>` : ""}
            </div>
          `
            : ""
        }

        ${
          hasAccess && existing.locationUrl
            ? `
            <div class="location-box">
              <span class="location-label">Access Location:</span>
              <a href="${existing.locationUrl}" target="_blank" class="location-link">
                🔗 View in Registry (Dataset #${existing.datasetId || ""})
              </a>
            </div>
          `
            : !hasAccess
            ? `
            <div class="restricted-box">
              🔒 <strong>Access Controlled (${escapeHtml(existing.classification || "Restricted")}):</strong>
              ${escapeHtml(existing.restrictedNote || "Contact data custodian to request access.")}
            </div>
          `
            : ""
        }
      </div>

      ${renderBreakdown(score, breakdown, relType, false)}

      <div class="actions">
        <button class="btn-primary" id="ddas-use-existing">
          ${hasAccess ? "View / Use in Registry" : "Acknowledge & Cancel"}
        </button>
        <button class="btn-secondary" id="ddas-continue">Continue download</button>
      </div>
    `;

    const btnUse = shadow.getElementById("ddas-use-existing");
    if (btnUse) {
      btnUse.onclick = () => {
        if (hasAccess && existing.locationUrl) {
          window.open(existing.locationUrl, "_blank");
        }
        onUseExisting();
      };
    }
    const btnCont = shadow.getElementById("ddas-continue");
    if (btnCont) {
      btnCont.onclick = () => onContinue();
    }

  }

  return { host, close, showAlert };
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
        <span class="score-value">${score.toFixed(1)}%</span>
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
    background: #fff; border-radius: 4px; width: 380px; max-width: 90vw;
    padding: 20px; box-shadow: 0 12px 40px rgba(0,0,0,0.25);
  }
  .heading { font-size: 16px; font-weight: 600; margin-bottom: 6px; }
  .heading.danger { color: #BE123C; }
  .heading.warning { color: #D97706; }
  .heading.success { color: #0D9488; }
  .desc { font-size: 13px; color: #28395A; line-height: 1.5; margin: 0 0 12px; }
  .existing { background: #F5F7FA; border: 1px solid #DDE3EC; border-radius: 4px; padding: 12px; margin-bottom: 12px; }
  .existing-title { font-size: 13px; font-weight: 600; color: #0A0F1C; }
  .existing-meta { font-size: 11px; color: #64748B; margin-top: 3px; display: flex; gap: 6px; font-family: 'JetBrains Mono', monospace; }
  .existing-attrs { font-size: 11px; color: #334155; margin-top: 6px; padding-top: 6px; border-top: 1px dashed #CBD5E1; display: flex; flex-direction: column; gap: 2px; }
  .location-box { margin-top: 8px; padding: 6px 8px; background: #EEF2FF; border: 1px solid #C7D2FE; border-radius: 3px; font-size: 11px; }
  .location-label { color: #4338CA; font-weight: 600; display: block; margin-bottom: 2px; }
  .location-link { color: #4F46E5; text-decoration: underline; font-weight: 500; word-break: break-all; }
  .restricted-box { margin-top: 8px; padding: 6px 8px; background: #FEF2F2; border: 1px solid #FECACA; border-radius: 3px; font-size: 11px; color: #991B1B; line-height: 1.4; }
  .score-block { margin-bottom: 14px; }
  .score-row { display: flex; justify-content: space-between; align-items: baseline; }
  .score-label { font-size: 11px; text-transform: uppercase; color: #64748B; letter-spacing: 0.02em; }
  .score-value { font-family: 'JetBrains Mono', monospace; font-size: 20px; font-weight: 600; color: #0A0F1C; }
  .badge { display: inline-block; font-size: 10px; font-family: 'JetBrains Mono', monospace; text-transform: uppercase;
    background: #FEF3C7; color: #D97706; border: 1px solid #FDE68A; padding: 2px 6px; border-radius: 3px; margin: 4px 0 8px; }
  .badge-local { background: #E0F2FE; color: #0369A1; border-color: #BAE6FD; margin: 0; }
  .badge-registry { background: #EDE9FE; color: #6D28D9; border-color: #DDD6FE; margin: 0; }
  .badge-restricted { background: #FEE2E2; color: #991B1B; border-color: #FECACA; margin: 0; }
  .breakdown-table { width: 100%; font-size: 12px; border-collapse: collapse; }
  .breakdown-table td { padding: 4px 0; border-top: 1px solid #ECEFF4; color: #1B2A45; }
  .breakdown-table td.num { text-align: right; font-family: 'JetBrains Mono', monospace; }
  .actions { display: flex; gap: 8px; margin-top: 4px; }
  .btn-primary, .btn-secondary {
    flex: 1; font-size: 13px; font-weight: 500; padding: 9px 12px; border-radius: 3px;
    cursor: pointer; border: none; transition: opacity 0.15s; text-align: center;
  }
  .btn-primary { background: #0D9488; color: #FFFFFF; }
  .btn-secondary { background: #fff; color: #1B2A45; border: 1px solid #DDE3EC; }
  .btn-primary:hover, .btn-secondary:hover { opacity: 0.85; }

`;
})();
