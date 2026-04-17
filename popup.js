const CLEANUP_STORAGE_KEY = "cleanupOnDomainExit";
const TAB_LOGS_STORAGE_KEY = "tabLogs";
const toggle = document.getElementById("cleanup-toggle");
const logStatus = document.getElementById("log-status");
const logMessage = document.getElementById("log-message");
const logMeta = document.getElementById("log-meta");
const resetButton = document.getElementById("reset-domain");
const managePatternsButton = document.getElementById("manage-patterns");

async function initialize() {
  const stored = await chrome.storage.sync.get(CLEANUP_STORAGE_KEY);
  toggle.checked = Boolean(stored[CLEANUP_STORAGE_KEY]);
  await renderTabLog();
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

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[TAB_LOGS_STORAGE_KEY]) {
    void renderTabLog();
  }
});

async function renderTabLog() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    logStatus.textContent = "No active tab.";
    logMessage.textContent = "";
    logMeta.textContent = "";
    return;
  }

  const stored = await chrome.storage.local.get(TAB_LOGS_STORAGE_KEY);
  const entry = stored[TAB_LOGS_STORAGE_KEY]?.[String(tab.id)];

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

void initialize();
