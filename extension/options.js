const input = document.getElementById("apiBase");
const saveBtn = document.getElementById("save");
const savedMsg = document.getElementById("saved");

const dirStatus = document.getElementById("dir-status");
const selectDirBtn = document.getElementById("select-dir-btn");
const refreshDirBtn = document.getElementById("refresh-dir-btn");
const manualIndexBtn = document.getElementById("manual-index-btn");
const clearRegistryBtn = document.getElementById("clear-registry-btn");
const fileInput = document.getElementById("options-file-input");
const statusMsg = document.getElementById("status-msg");
const recordCount = document.getElementById("record-count");
const tableBody = document.getElementById("records-table-body");

let currentDirHandle = null;

async function load() {
  input.value = await getApiBase();
  await checkDirectoryHandle();
  await loadRecordsTable();
}

async function checkDirectoryHandle() {
  try {
    currentDirHandle = await getDirectoryHandle();
    if (currentDirHandle) {
      dirStatus.textContent = `Connected (${currentDirHandle.name})`;
      dirStatus.className = "status-badge status-ok";
      selectDirBtn.textContent = "📂 Change Folder";
    } else {
      dirStatus.textContent = "Not connected";
      dirStatus.className = "status-badge status-warn";
    }
  } catch (err) {
    dirStatus.textContent = "Not connected";
    dirStatus.className = "status-badge status-warn";
  }
}

async function loadRecordsTable() {
  const records = await getAllLocalRecords().catch(() => []);
  recordCount.textContent = records.length;

  if (records.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#94A3B8; padding:16px;">No tracked files in local registry.</td></tr>`;
    return;
  }

  tableBody.innerHTML = records
    .map((r) => {
      const name = r.fileName || r.filename || "file";
      const sizeKb = ((r.sizeBytes || r.fileSize || 0) / 1024).toFixed(1);
      const rowCount = r.structuralFingerprint?.rowCount;
      const rowText = rowCount !== undefined ? ` (${rowCount} rows)` : "";
      const source = r.isManualIndex ? "Manual Index" : r.isTrackedFolder ? "Tracked Folder" : r.source || "Download";
      const date = new Date(r.downloadedAt || r.timestamp || Date.now()).toLocaleDateString();
      const hashPrefix = r.sha256 ? r.sha256.slice(0, 8) : "";

      return `
        <tr>
          <td>
            <div class="file-name">${escapeHtml(name)}</div>
            <div class="file-meta">${hashPrefix}...</div>
          </td>
          <td>${sizeKb} KB${rowText}</td>
          <td><span class="status-badge ${r.isManualIndex ? "status-ok" : "status-warn"}">${source}</span></td>
          <td>${date}</td>
          <td>
            <button class="btn btn-danger" style="padding:4px 8px; font-size:11px;" data-sha="${r.sha256}">Delete</button>
          </td>
        </tr>
      `;
    })
    .join("");

  tableBody.querySelectorAll("button[data-sha]").forEach((btn) => {
    btn.onclick = async () => {
      const sha = btn.getAttribute("data-sha");
      await deleteLocalRecord(sha);
      await loadRecordsTable();
      showStatus("Record deleted from local device registry.");
    };
  });
}

saveBtn.onclick = async () => {
  await setApiBase(input.value.trim());
  savedMsg.style.display = "inline";
  setTimeout(() => (savedMsg.style.display = "none"), 2000);
};

// Option B: Native File System Access API
selectDirBtn.onclick = async () => {
  if (typeof window.showDirectoryPicker !== "function") {
    showStatus("File System Access API is not supported in this browser environment.", true);
    return;
  }

  try {
    const dirHandle = await window.showDirectoryPicker({ mode: "read" });
    await saveDirectoryHandle(dirHandle);
    currentDirHandle = dirHandle;
    await checkDirectoryHandle();
    showStatus(`Folder "${dirHandle.name}" connected. Click "Re-scan Tracked Files" to refresh signatures.`);
  } catch (err) {
    if (err.name !== "AbortError") {
      showStatus(`Folder selection failed: ${err.message}`, true);
    }
  }
};

refreshDirBtn.onclick = async () => {
  if (!currentDirHandle) {
    showStatus("Please grant folder access first by clicking 'Grant Folder Access'.", true);
    return;
  }

  refreshDirBtn.disabled = true;
  refreshDirBtn.textContent = "Scanning...";

  try {
    const result = await refreshTrackedFilesFromDirectory(currentDirHandle);
    showStatus(`Directory scan complete: ${result.updated} file(s) updated, ${result.scanned} tracked file(s) scanned.`);
    await loadRecordsTable();
  } catch (err) {
    showStatus(`Scan failed: ${err.message}`, true);
  } finally {
    refreshDirBtn.disabled = false;
    refreshDirBtn.textContent = "🔄 Re-scan Tracked Files";
  }
};

manualIndexBtn.onclick = () => fileInput.click();

fileInput.onchange = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const fingerprint = await fingerprintLocalFile(file, {
      isManualIndex: true,
      downloadPath: file.name,
    });
    await saveLocalRecord(fingerprint);
    fileInput.value = "";
    await loadRecordsTable();
    showStatus(`Successfully indexed "${file.name}" into local registry.`);
  } catch (err) {
    showStatus(`Failed to index file: ${err.message}`, true);
  }
};

clearRegistryBtn.onclick = async () => {
  if (!confirm("Are you sure you want to clear all tracked duplicate records from this device?")) return;
  await clearLocalStore();
  await loadRecordsTable();
  showStatus("Local device duplicate history cleared.");
};

function showStatus(msg, isError = false) {
  statusMsg.innerHTML = `<span style="color: ${isError ? "#BE123C" : "#0D9488"}; font-weight: 500;">${escapeHtml(msg)}</span>`;
  setTimeout(() => {
    statusMsg.innerHTML = "";
  }, 4000);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

load();

