const content = document.getElementById("content");
const fileInput = document.getElementById("local-file-input");

let feedbackBanner = "";

async function render() {
  const { token, user } = await getAuth();
  if (!token || !user) {
    await renderLogin();
  } else {
    await renderSignedIn(user);
  }
}

async function renderLogin(error) {
  const records = await getAllLocalRecords().catch(() => []);

  content.innerHTML = `
    ${feedbackBanner ? `<div class="success-banner">${feedbackBanner}</div>` : ""}
    ${error ? `<div class="error">${error}</div>` : ""}
    <label for="email">Official email</label>
    <input id="email" type="email" placeholder="admin@ddas.gov.in" value="admin@ddas.gov.in" />
    <label for="password">Password</label>
    <input id="password" type="password" placeholder="••••••••" value="admin123" />
    <button class="btn-primary" id="login-btn">Sign in</button>

    <div class="stats-badge">
      <span>Tracked on this device</span>
      <span class="stats-count">${records.length} files</span>
    </div>

    <button class="btn-accent" id="index-local-btn">📁 Index a local file</button>
    <button class="btn-secondary" id="clear-cache-btn">Clear Device Cache</button>
    <button class="btn-secondary" id="settings-btn">API & Directory Settings</button>
  `;

  document.getElementById("login-btn").onclick = handleLogin;
  document.getElementById("index-local-btn").onclick = () => fileInput.click();
  document.getElementById("clear-cache-btn").onclick = handleClearCache;
  document.getElementById("settings-btn").onclick = () => chrome.runtime.openOptionsPage();
}

async function renderSignedIn(user) {
  const enabled = await isInterceptionEnabled();
  const records = await getAllLocalRecords().catch(() => []);

  content.innerHTML = `
    ${feedbackBanner ? `<div class="success-banner">${feedbackBanner}</div>` : ""}
    <div class="user-row">
      <div>
        <div class="user-name">${user.name}</div>
        <div class="user-meta">${user.department} · ${user.role}</div>
      </div>
    </div>
    <div class="toggle-row">
      <span class="toggle-label">Check downloads automatically</span>
      <input type="checkbox" id="toggle" ${enabled ? "checked" : ""} />
    </div>

    <div class="stats-badge">
      <span>Tracked local datasets</span>
      <span class="stats-count">${records.length} files</span>
    </div>

    <button class="btn-accent" id="index-local-btn">📁 Index a local file</button>
    <button class="btn-secondary" id="refresh-index-btn">🔄 Refresh tracked index</button>
    <button class="btn-secondary" id="clear-cache-btn">Clear Device Cache</button>
    <button class="btn-secondary" id="signout-btn">Sign out</button>
    <a href="#" id="settings-link" class="footer-link">Advanced & Directory Settings</a>
  `;

  document.getElementById("toggle").onchange = (e) => setInterceptionEnabled(e.target.checked);
  document.getElementById("index-local-btn").onclick = () => fileInput.click();
  document.getElementById("refresh-index-btn").onclick = handleRefreshIndex;
  document.getElementById("clear-cache-btn").onclick = handleClearCache;
  document.getElementById("signout-btn").onclick = async () => {
    await clearAuth();
    await render();
  };
  document.getElementById("settings-link").onclick = (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  };
}

async function handleLogin() {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const apiBase = await getApiBase();

  try {
    const res = await fetch(`${apiBase}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      renderLogin(data.error || "Login failed");
      return;
    }
    await setAuth(data.token, data.user);
    await render();
  } catch (err) {
    renderLogin(`Couldn't reach ${apiBase} — check API settings.`);
  }
}

async function handleClearCache() {
  const btn = document.getElementById("clear-cache-btn");
  if (btn) btn.textContent = "Clearing...";
  chrome.runtime.sendMessage({ type: "CLEAR_LOCAL_CACHE" }, () => {
    feedbackBanner = "Device cache cleared successfully.";
    render();
    setTimeout(() => {
      feedbackBanner = "";
      render();
    }, 2500);
  });
}

// Option A: Manual file picker indexing
fileInput.onchange = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const fingerprint = await fingerprintLocalFile(file, {
      isManualIndex: true,
      downloadPath: file.name,
    });

    await saveLocalRecord(fingerprint);

    const rowCount = fingerprint.structuralFingerprint?.rowCount;
    const sizeKb = (fingerprint.sizeBytes / 1024).toFixed(1);
    const rowInfo = rowCount !== undefined ? `${rowCount} rows, ` : "";

    feedbackBanner = `✓ Indexed "<strong>${escapeHtml(file.name)}</strong>" (${rowInfo}${sizeKb} KB) into local registry.`;
    fileInput.value = "";
    await render();
  } catch (err) {
    feedbackBanner = `Failed to index file: ${err.message}`;
    fileInput.value = "";
    await render();
  }
};

// Option B: Directory refresh
async function handleRefreshIndex() {
  const btn = document.getElementById("refresh-index-btn");
  if (btn) btn.textContent = "Checking disk...";

  const dirHandle = await getDirectoryHandle().catch(() => null);
  if (!dirHandle) {
    // If no directory granted yet, open options page to grant access
    chrome.runtime.openOptionsPage();
    return;
  }

  try {
    const result = await refreshTrackedFilesFromDirectory(dirHandle);
    feedbackBanner = `Index refreshed: ${result.updated} updated (${result.scanned} scanned).`;
  } catch (err) {
    feedbackBanner = `Refresh error: ${err.message}`;
  }

  await render();
  setTimeout(() => {
    feedbackBanner = "";
    render();
  }, 4000);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

render();

