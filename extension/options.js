const input = document.getElementById("apiBase");
const saveBtn = document.getElementById("save");
const savedMsg = document.getElementById("saved");
const clearRegistryBtn = document.getElementById("clear-registry-btn");
const statusMsg = document.getElementById("status-msg");
const recordCount = document.getElementById("record-count");
const tableBody = document.getElementById("records-table-body");

async function load() {
  input.value = await getApiBase();
  await loadRecordsTable();
}

async function loadRecordsTable() {
  const records = await getAllLocalRecords().catch(() => []);
  recordCount.textContent = records.length;

  if (records.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#94A3B8; padding:16px;">No downloads tracked in local device cache yet.</td></tr>`;
    return;
  }

  tableBody.innerHTML = records
    .map((r) => {
      const name = r.fileName || r.filename || "file";
      const sizeKb = ((r.sizeBytes || r.fileSize || 0) / 1024).toFixed(1);
      const rowCount = r.structuralFingerprint?.rowCount;
      const rowText = rowCount !== undefined ? ` (${rowCount} rows)` : "";
      const source = r.source || "Browser Interception";
      const date = new Date(r.downloadedAt || r.timestamp || Date.now()).toLocaleDateString();
      const hashPrefix = r.sha256 ? r.sha256.slice(0, 8) : "";

      return `
        <tr>
          <td>
            <div class="file-name">${escapeHtml(name)}</div>
            <div class="file-meta">${hashPrefix}...</div>
          </td>
          <td>${sizeKb} KB${rowText}</td>
          <td><span class="status-badge">${escapeHtml(source)}</span></td>
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
      showStatus("Record removed from local device cache.");
    };
  });
}

saveBtn.onclick = async () => {
  await setApiBase(input.value.trim());
  savedMsg.style.display = "inline";
  setTimeout(() => (savedMsg.style.display = "none"), 2000);
};

clearRegistryBtn.onclick = async () => {
  if (confirm("Clear all locally cached download fingerprints on this device?")) {
    await clearLocalStore();
    await loadRecordsTable();
    showStatus("Local device cache cleared.");
  }
};

function showStatus(msg, isError = false) {
  statusMsg.textContent = msg;
  statusMsg.style.color = isError ? "#E11D48" : "#0D9488";
  setTimeout(() => (statusMsg.textContent = ""), 3000);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

load();
