const content = document.getElementById("content");

async function render() {
  const { token, user } = await getAuth();
  if (!token || !user) {
    renderLogin();
  } else {
    await renderSignedIn(user);
  }
}

function renderLogin(error) {
  content.innerHTML = `
    ${error ? `<div class="error">${error}</div>` : ""}
    <label for="email">Official email</label>
    <input id="email" type="email" placeholder="you@department.gov.in" />
    <label for="password">Password</label>
    <input id="password" type="password" placeholder="••••••••" />
    <button class="btn-primary" id="login-btn">Sign in</button>
    <button class="btn-secondary" id="settings-btn">API settings</button>
  `;
  document.getElementById("login-btn").onclick = handleLogin;
  document.getElementById("settings-btn").onclick = () => chrome.runtime.openOptionsPage();
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

async function renderSignedIn(user) {
  const enabled = await isInterceptionEnabled();
  content.innerHTML = `
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
    <button class="btn-secondary" id="clear-cache-btn" style="margin-top:8px">Clear Device Cache</button>
    <button class="btn-secondary" id="signout-btn" style="margin-top:8px">Sign out</button>
    <a href="#" id="settings-link" class="footer-link">API settings</a>
  `;

  document.getElementById("toggle").onchange = (e) => setInterceptionEnabled(e.target.checked);
  document.getElementById("clear-cache-btn").onclick = async () => {
    const btn = document.getElementById("clear-cache-btn");
    btn.textContent = "Clearing...";
    chrome.runtime.sendMessage({ type: "CLEAR_LOCAL_CACHE" }, () => {
      btn.textContent = "Cache Cleared ✓";
      setTimeout(() => { btn.textContent = "Clear Device Cache"; }, 2000);
    });
  };
  document.getElementById("signout-btn").onclick = async () => {
    await clearAuth();
    await render();
  };
  document.getElementById("settings-link").onclick = (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  };
}

render();
