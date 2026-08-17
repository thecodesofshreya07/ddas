// DDAS Live Test Simulator Script

function generate100RowCsv(modifications = 0) {
  let lines = ["id,name,email,role,department"];
  for (let i = 1; i <= 100; i++) {
    if (modifications > 0 && (i === 12 || i === 47)) {
      lines.push(`${i},Modified_User_${i},mod_${i}@example.com,Lead Architect,Research`);
    } else {
      lines.push(`${i},User_${i},user_${i}@example.com,Software Engineer,Engineering`);
    }
  }
  return lines.join("\n");
}

function generateAccessCodeCsv(modifications = 0) {
  let lines = ["code_id,service,access_level,expires_at"];
  for (let i = 1; i <= 50; i++) {
    if (modifications > 0 && (i === 5 || i === 25)) {
      lines.push(`AC_${i},AWS_PROD_UPDATED,ADMIN,2026-12-31`);
    } else {
      lines.push(`AC_${i},AWS_PROD,READ_ONLY,2026-10-31`);
    }
  }
  return lines.join("\n");
}

function log(msg) {
  const logsEl = document.getElementById("logs");
  const div = document.createElement("div");
  div.className = "log-item";
  div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logsEl.appendChild(div);
  logsEl.scrollTop = logsEl.scrollHeight;
}

document.addEventListener("DOMContentLoaded", () => {
  const baseFilenameInput = document.getElementById("base-filename");
  const baseCsvArea = document.getElementById("base-csv");
  const targetFilenameInput = document.getElementById("target-filename");
  const targetCsvArea = document.getElementById("target-csv");

  // Defaults
  baseCsvArea.value = generate100RowCsv(0);
  targetCsvArea.value = generate100RowCsv(2);

  // Preset Buttons
  document.getElementById("btn-load-users").onclick = () => {
    baseFilenameInput.value = "users.csv";
    baseCsvArea.value = generate100RowCsv(0);
    targetFilenameInput.value = "users-v2.csv";
    targetCsvArea.value = generate100RowCsv(2);
    log("Loaded 100-Row Users baseline dataset.");
  };

  document.getElementById("btn-load-passwords").onclick = () => {
    baseFilenameInput.value = "access-code-recovery.csv";
    baseCsvArea.value = generateAccessCodeCsv(0);
    targetFilenameInput.value = "access-code-recovery-edited.csv";
    targetCsvArea.value = generateAccessCodeCsv(2);
    log("Loaded Access Code dataset.");
  };

  document.getElementById("btn-mod-2rows").onclick = () => {
    targetFilenameInput.value = baseFilenameInput.value.replace(".csv", "-edited.csv");
    targetCsvArea.value = generate100RowCsv(2);
    log("Generated target with 2 rows edited (98% content similarity).");
  };

  document.getElementById("btn-mod-rename").onclick = () => {
    targetFilenameInput.value = baseFilenameInput.value.replace(".csv", "-v2.csv");
    targetCsvArea.value = baseCsvArea.value;
    log("Generated target with exact same content, renamed filename (-v2.csv).");
  };

  document.getElementById("btn-mod-unrelated").onclick = () => {
    targetFilenameInput.value = "weather_delhi_2026.csv";
    targetCsvArea.value = "station_id,temperature,humidity,rainfall\n101,34.5,65,0.0\n102,33.8,70,1.2\n103,35.1,60,0.0";
    log("Generated completely unrelated weather dataset (threshold guard test).");
  };

  // Save Baseline to Local Device Registry (IndexedDB)
  document.getElementById("btn-save-baseline").onclick = async () => {
    const filename = baseFilenameInput.value.trim() || "dataset.csv";
    const text = baseCsvArea.value;
    const blob = new Blob([text], { type: "text/csv" });
    const buffer = await blob.arrayBuffer();

    const sha256 = await sha256Hex(buffer);
    const parsed = parseCsvText(text, ",");
    const contentSignature = await buildRowContentSignature(parsed.rows);

    const record = {
      fileName: filename,
      filename: filename,
      sizeBytes: buffer.byteLength,
      fileSize: buffer.byteLength,
      mimeType: "text/csv",
      sha256,
      byteHash: sha256,
      schemaFingerprint: {
        columns: parsed.columns,
        rowCount: parsed.rowCount,
        columnStats: parsed.columnStats,
      },
      contentSignature,
      downloadedAt: Date.now(),
    };

    await saveLocalRecord(record);
    log(`✓ Successfully saved "${filename}" (SHA: ${sha256.substring(0, 12)}...) to on-device registry!`);
  };

  // Trigger Real Browser Download & Test DDAS Interception
  document.getElementById("btn-trigger-download").onclick = () => {
    const filename = targetFilenameInput.value.trim() || "download.csv";
    const text = targetCsvArea.value;
    const blob = new Blob([text], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    log(`Triggering in-browser download for "${filename}" (Blob URL)...`);

    // Creates anchor and triggers native download event -> intercepted by background.js
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 2000);
  };

  // Clear Cache Button
  document.getElementById("btn-clear-cache").onclick = async () => {
    chrome.runtime.sendMessage({ type: "CLEAR_LOCAL_CACHE" }, () => {
      log("🗑️ All on-device fingerprint records have been cleared from IndexedDB.");
    });
  };
});
