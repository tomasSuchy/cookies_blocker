const CLEANUP_STORAGE_KEY = "cleanupOnDomainExit";
const TAB_LOGS_STORAGE_KEY = "tabLogs";
const SITE_RULES_STORAGE_KEY = "siteRules";
const DEBUG_HISTORY_ENABLED_STORAGE_KEY = "debugHistoryEnabled";
const DEBUG_HISTORY_STORAGE_KEY = "debugHistory";
const toggle = document.getElementById("cleanup-toggle");
const logStatus = document.getElementById("log-status");
const logMessage = document.getElementById("log-message");
const logMeta = document.getElementById("log-meta");
const resetButton = document.getElementById("reset-domain");
const managePatternsButton = document.getElementById("manage-patterns");
const siteHost = document.getElementById("site-host");
const siteRuleSelect = document.getElementById("site-rule");
const debugToggle = document.getElementById("debug-toggle");
const debugHistoryList = document.getElementById("debug-history");
const debugEmpty = document.getElementById("debug-empty");

let currentTab = null;
let currentHostname = null;

async function initialize() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab || null;
  currentHostname = currentTab?.url ? getHostnameFromUrl(currentTab.url) : null;

  const stored = await chrome.storage.sync.get([
    CLEANUP_STORAGE_KEY,
    SITE_RULES_STORAGE_KEY,
    DEBUG_HISTORY_ENABLED_STORAGE_KEY
  ]);
  toggle.checked = Boolean(stored[CLEANUP_STORAGE_KEY]);
  debugToggle.checked = Boolean(stored[DEBUG_HISTORY_ENABLED_STORAGE_KEY]);
  renderSiteRule(stored[SITE_RULES_STORAGE_KEY] || {});
  await renderTabLog();
  await renderDebugHistory();
}

toggle.addEventListener("change", async () => {
  await chrome.storage.sync.set({
    [CLEANUP_STORAGE_KEY]: toggle.checked
  });
});

resetButton.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    return;
  }

  resetButton.disabled = true;

  try {
    await chrome.runtime.sendMessage({
      type: "cookies-blocker-reset-domain",
      tabId: tab.id,
      url: tab.url
    });
    window.close();
  } finally {
    resetButton.disabled = false;
  }
});

managePatternsButton.addEventListener("click", async () => {
  await chrome.runtime.openOptionsPage();
  window.close();
});

siteRuleSelect.addEventListener("change", async () => {
  if (!currentHostname) {
    return;
  }

  const stored = await chrome.storage.sync.get(SITE_RULES_STORAGE_KEY);
  const siteRules = stored[SITE_RULES_STORAGE_KEY] || {};

  if (siteRuleSelect.value === "default") {
    delete siteRules[currentHostname];
  } else {
    siteRules[currentHostname] = siteRuleSelect.value;
  }

  await chrome.storage.sync.set({ [SITE_RULES_STORAGE_KEY]: siteRules });
});

debugToggle.addEventListener("change", async () => {
  await chrome.storage.sync.set({
    [DEBUG_HISTORY_ENABLED_STORAGE_KEY]: debugToggle.checked
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[TAB_LOGS_STORAGE_KEY]) {
    void renderTabLog();
  }

  if (areaName === "local" && changes[DEBUG_HISTORY_STORAGE_KEY]) {
    void renderDebugHistory();
  }

  if (areaName === "sync" && changes[SITE_RULES_STORAGE_KEY]) {
    renderSiteRule(changes[SITE_RULES_STORAGE_KEY].newValue || {});
  }

  if (areaName === "sync" && changes[DEBUG_HISTORY_ENABLED_STORAGE_KEY]) {
    debugToggle.checked = Boolean(changes[DEBUG_HISTORY_ENABLED_STORAGE_KEY].newValue);
  }
});

async function renderTabLog() {
  if (!currentTab?.id) {
    logStatus.textContent = "No active tab.";
    logMessage.textContent = "";
    logMeta.textContent = "";
    return;
  }

  const stored = await chrome.storage.local.get(TAB_LOGS_STORAGE_KEY);
  const entry = stored[TAB_LOGS_STORAGE_KEY]?.[String(currentTab.id)];

  if (!entry) {
    logStatus.textContent = "No data yet.";
    logMessage.textContent = "Open or refresh a page to run detection.";
    logMeta.textContent = "";
    return;
  }

  logStatus.textContent = formatStatus(entry.status);
  logMessage.textContent = entry.message || "";

  const parts = [];
  if (entry.hostname) {
    parts.push(entry.hostname);
  }
  if (entry.updatedAt) {
    parts.push(formatTime(entry.updatedAt));
  }
  logMeta.textContent = parts.join(" • ");
}

async function renderDebugHistory() {
  if (!currentHostname) {
    siteHost.textContent = "No active site";
    debugHistoryList.innerHTML = "";
    debugEmpty.textContent = "Open a regular website tab to inspect its debug history.";
    siteRuleSelect.disabled = true;
    debugToggle.disabled = true;
    return;
  }

  siteHost.textContent = currentHostname;
  siteRuleSelect.disabled = false;
  debugToggle.disabled = false;

  const stored = await chrome.storage.local.get(DEBUG_HISTORY_STORAGE_KEY);
  const events = stored[DEBUG_HISTORY_STORAGE_KEY]?.[currentHostname] || [];

  if (!Array.isArray(events) || events.length === 0) {
    debugHistoryList.innerHTML = "";
    debugEmpty.textContent = "Debug history is empty for this site.";
    return;
  }

  debugEmpty.textContent = "";
  debugHistoryList.innerHTML = events.map(renderDebugItem).join("");
}

function renderSiteRule(siteRules) {
  if (!currentHostname) {
    siteHost.textContent = "No active site";
    siteRuleSelect.value = "default";
    siteRuleSelect.disabled = true;
    return;
  }

  siteHost.textContent = currentHostname;
  siteRuleSelect.disabled = false;
  siteRuleSelect.value = siteRules[currentHostname] || "default";
}

function renderDebugItem(event) {
  const time = event.createdAt ? formatTime(event.createdAt) : "";
  const label = [event.type, event.strategy].filter(Boolean).join(" • ");
  const safeLabel = escapeHtml(label || "event");
  const safeTime = escapeHtml(time);
  const safeDetail = escapeHtml(event.detail || "");

  return `
    <li class="debug-item">
      <p class="debug-top">${safeLabel}${safeTime ? ` • ${safeTime}` : ""}</p>
      <p class="debug-detail">${safeDetail || "No detail."}</p>
    </li>
  `;
}

function formatStatus(status) {
  if (status === "success") {
    return "Success";
  }
  if (status === "failure") {
    return "No Match";
  }
  if (status === "pending") {
    return "Running";
  }
  if (status === "paused") {
    return "Paused";
  }
  return "Unknown";
}

function formatTime(value) {
  return new Date(value).toLocaleString();
}

function getHostnameFromUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.hostname;
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

void initialize();
