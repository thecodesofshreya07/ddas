// Shared across background.js, popup.js, options.js.
// chrome.storage.local, not localStorage — extensions don't share
// localStorage between contexts the way a normal web page does.

const DEFAULT_API_BASE = "http://localhost:4000";

async function getApiBase() {
  const { apiBase } = await chrome.storage.local.get("apiBase");
  return apiBase || DEFAULT_API_BASE;
}

async function setApiBase(url) {
  await chrome.storage.local.set({ apiBase: url });
}

async function getAuth() {
  const { token, user } = await chrome.storage.local.get(["token", "user"]);
  return { token: token || null, user: user || null };
}

async function setAuth(token, user) {
  await chrome.storage.local.set({ token, user });
}

async function clearAuth() {
  await chrome.storage.local.remove(["token", "user"]);
}

async function isInterceptionEnabled() {
  const { interceptionEnabled } = await chrome.storage.local.get("interceptionEnabled");
  // Default ON — the whole point of the extension is passive protection.
  return interceptionEnabled !== false;
}

async function setInterceptionEnabled(enabled) {
  await chrome.storage.local.set({ interceptionEnabled: enabled });
}
