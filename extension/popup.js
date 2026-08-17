const content = document.getElementById("content");

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

    <div class="stats-badge" style="margin-top: 12px;">
      <span>Protected downloads</span>
      <span class="stats-count">${records.length} tracked</span>
    </div>

    <button class="btn-secondary" id="clear-cache-btn">Clear Local Cache</button>
    <button class="btn-secondary" id="settings-btn">Extension Settings</button>
  `;

  document.getElementById("login-btn").onclick = handleLogin;
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
        <div class="user-name">${escapeHtml(user.name)}</div>
        <div class="user-meta">${escapeHtml(user.department)} · ${escapeHtml(user.role)}</div>
      </div>
    </div>
    <div class="toggle-row">
      <span class="toggle-label">Automatic download check</span>
      <input type="checkbox" id="toggle" ${enabled ? "checked" : ""} />
    </div>

    <div class="stats-badge">
      <span>Tracked on this device</span>
      <span class="stats-count">${records.length} files</span>
    </div>

    <button class="btn-primary" id="open-portal-btn">🌐 Open Institute Registry</button>
    <button class="btn-secondary" id="clear-cache-btn">Clear Device Cache</button>
    <button class="btn-secondary" id="signout-btn">Sign out</button>
    <a href="#" id="settings-link" class="footer-link">Extension Settings</a>
  `;

  document.getElementById("toggle").onchange = (e) => setInterceptionEnabled(e.target.checked);
  document.getElementById("open-portal-btn").onclick = () => chrome.tabs.create({ url: "http://localhost:5173" });
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
    renderLogin(`Couldn't reach ${apiBase} — verify DDAS backend is running.`);
  }
}

async function handleClearCache() {
  const btn = document.getElementById("clear-cache-btn");
  if (btn) btn.textContent = "Clearing...";
  try {
    chrome.runtime.sendMessage({ type: "CLEAR_LOCAL_CACHE" }, () => {
      if (chrome.runtime.lastError) {
        // safely consumed
      }
      feedbackBanner = "Device cache cleared successfully.";
      render();
      setTimeout(() => {
        feedbackBanner = "";
        render();
      }, 2500);
    });
  } catch {
    feedbackBanner = "Device cache cleared successfully.";
    render();
  }
}


function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

render();
