const CLEANUP_STORAGE_KEY = "cleanupOnDomainExit";
const DEFAULT_CLEANUP_ENABLED = false;
const TAB_LOGS_STORAGE_KEY = "tabLogs";
const PAUSED_AUTO_REJECT_STORAGE_KEY = "pausedAutoReject";
const tabHostnames = new Map();
const tabResultStates = new Map();
const pausedAutoReject = new Map();
const INJECTED_FILES = [
  "cmp/onetrust.js",
  "cmp/cookiebot.js",
  "cmp/didomi.js",
  "cmp/usercentrics.js",
  "cmp/fastcmp.js",
  "content-script.js"
];
const ICON_STYLES = {
  idle: {
    background: "#64748b",
    symbol: "C",
    symbolColor: "#ffffff",
    title: "Cookies Blocker"
  },
  pending: {
    background: "#2563eb",
    symbol: "...",
    symbolColor: "#ffffff",
    title: "Cookies Blocker: detection in progress"
  },
  success: {
    background: "#15803d",
    symbol: "OK",
    symbolColor: "#ffffff",
    title: "Cookies Blocker: cookies rejected"
  },
  failure: {
    background: "#b91c1c",
    symbol: "NO",
    symbolColor: "#ffffff",
    title: "Cookies Blocker: no rejection strategy matched"
  }
};
const ICON_SIZES = [16, 32];

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(CLEANUP_STORAGE_KEY);
  if (typeof stored[CLEANUP_STORAGE_KEY] !== "boolean") {
    await chrome.storage.sync.set({ [CLEANUP_STORAGE_KEY]: DEFAULT_CLEANUP_ENABLED });
  }

  await initializeTrackedTabs();
});

chrome.runtime.onStartup.addListener(() => {
  void initializeTrackedTabs();
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const hostname = tabHostnames.get(tabId);
  tabHostnames.delete(tabId);
  tabResultStates.delete(tabId);
  await clearPausedAutoReject(tabId);
  await removeTabLog(tabId);
  if (!hostname) {
    return;
  }

  if (await isCleanupEnabled()) {
    await clearCookiesForHostname(hostname);
  }
});

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) {
    return;
  }

  const nextHostname = getHostnameFromUrl(details.url);
  const previousHostname = tabHostnames.get(details.tabId);

  if (!nextHostname) {
    tabHostnames.delete(details.tabId);
    await clearPausedAutoReject(details.tabId);
    return;
  }

  tabHostnames.set(details.tabId, nextHostname);

  const pausedHostname = pausedAutoReject.get(details.tabId);
  if (pausedHostname && pausedHostname !== nextHostname) {
    await clearPausedAutoReject(details.tabId);
  }

  if (previousHostname && previousHostname !== nextHostname && await isCleanupEnabled()) {
    await clearCookiesForHostname(previousHostname);
  }

  await setIconState(details.tabId, "idle");
  tabResultStates.delete(details.tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) {
    return;
  }

  const hostname = getHostnameFromUrl(tab.url);
  if (hostname) {
    tabHostnames.set(tabId, hostname);
  }

  if (!isInjectableUrl(tab.url)) {
    return;
  }

  if (hostname && pausedAutoReject.get(tabId) === hostname) {
    await setIconState(tabId, "idle");
    tabResultStates.delete(tabId);
    await writeTabLog(tabId, {
      status: "paused",
      mode: "paused",
      url: tab.url,
      hostname,
      message: "Auto-reject is paused for this tab so you can choose consent manually."
    });
    return;
  }

  try {
    await setIconState(tabId, "pending");
    tabResultStates.set(tabId, "pending");
    await writeTabLog(tabId, {
      status: "pending",
      mode: "injection",
      url: tab.url,
      hostname,
      message: "Detection started."
    });
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: INJECTED_FILES
    });
  } catch (error) {
    await setIconState(tabId, "failure");
    tabResultStates.set(tabId, "failure");
    await writeTabLog(tabId, {
      status: "failure",
      mode: "injection",
      url: tab.url,
      hostname,
      message: "Script injection failed."
    });
    console.warn("[Cookies Blocker] Failed to inject scripts", tab.url, error);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "cookies-blocker-reset-domain") {
    void handleResetDomain(message, sendResponse);
    return true;
  }

  if (message?.type === "cookies-blocker-is-paused") {
    const senderHostname = typeof message.hostname === "string" ? message.hostname : "";
    const paused = Boolean(
      sender.tab?.id &&
      senderHostname &&
      pausedAutoReject.get(sender.tab.id) === senderHostname
    );
    sendResponse({ paused });
    return;
  }

  if (message?.type !== "cookies-blocker-result" || !sender.tab?.id) {
    return;
  }

  const messageHostname = sender.tab.url ? getHostnameFromUrl(sender.tab.url) : null;
  if (messageHostname && pausedAutoReject.get(sender.tab.id) === messageHostname) {
    sendResponse({ ok: true, ignored: true, paused: true });
    return;
  }

  const status = message.status === "success" ? "success" : "failure";
  const currentStatus = tabResultStates.get(sender.tab.id);

  if (currentStatus === "success" && status === "failure") {
    sendResponse({ ok: true, ignored: true });
    return;
  }

  tabResultStates.set(sender.tab.id, status);
  void Promise.all([
    setIconState(sender.tab.id, status),
    writeTabLog(sender.tab.id, {
      status,
      mode: message.mode,
      url: sender.tab.url,
      hostname: sender.tab.url ? getHostnameFromUrl(sender.tab.url) : null,
      message: getResultMessage(status, message.mode)
    })
  ]);
  sendResponse({ ok: true });
});

async function handleResetDomain(message, sendResponse) {
  try {
    const tabId = Number(message.tabId);
    const url = typeof message.url === "string" ? message.url : "";
    const hostname = getHostnameFromUrl(url);

    if (!tabId || !hostname) {
      sendResponse({ ok: false, error: "Missing tab or hostname." });
      return;
    }

    await clearCookiesForHostname(hostname);
    await clearTabStorage(tabId);
    await setPausedAutoReject(tabId, hostname);
    await setIconState(tabId, "idle");
    tabResultStates.delete(tabId);
    await writeTabLog(tabId, {
      status: "paused",
      mode: "reset",
      url,
      hostname,
      message: "Consent data reset. Reloading page."
    });
    await chrome.tabs.reload(tabId);
    sendResponse({ ok: true });
  } catch (error) {
    console.warn("[Cookies Blocker] Failed to reset domain state", error);
    sendResponse({ ok: false, error: String(error) });
  }
}

async function initializeTrackedTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url) {
      continue;
    }

    const hostname = getHostnameFromUrl(tab.url);
    if (hostname) {
      tabHostnames.set(tab.id, hostname);
    }
  }
}

async function isCleanupEnabled() {
  const stored = await chrome.storage.sync.get(CLEANUP_STORAGE_KEY);
  return Boolean(stored[CLEANUP_STORAGE_KEY]);
}

function isInjectableUrl(url) {
  return url.startsWith("http://") || url.startsWith("https://");
}

function getHostnameFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return parsed.hostname;
  } catch (error) {
    console.warn("[Cookies Blocker] Failed to parse URL", url, error);
    return null;
  }
}

function getCandidateDomains(hostname) {
  const cleanHostname = hostname.replace(/^\.+/, "").toLowerCase();
  const parts = cleanHostname.split(".").filter(Boolean);
  const candidates = new Set([cleanHostname]);

  for (let index = 1; index < parts.length; index += 1) {
    candidates.add(parts.slice(index).join("."));
  }

  return Array.from(candidates);
}

async function clearCookiesForHostname(hostname) {
  const domains = getCandidateDomains(hostname);
  const cookieMap = new Map();

  for (const domain of domains) {
    const cookies = await chrome.cookies.getAll({ domain });
    for (const cookie of cookies) {
      if (!cookieMatchesHostname(cookie, hostname)) {
        continue;
      }

      const key = [
        cookie.name,
        cookie.domain,
        cookie.path,
        cookie.storeId,
        cookie.partitionKey?.topLevelSite || ""
      ].join("|");
      cookieMap.set(key, cookie);
    }
  }

  await Promise.all(Array.from(cookieMap.values()).map(removeCookie));
}

function cookieMatchesHostname(cookie, hostname) {
  const cookieDomain = cookie.domain.replace(/^\.+/, "").toLowerCase();
  const currentHostname = hostname.replace(/^\.+/, "").toLowerCase();
  return currentHostname === cookieDomain || currentHostname.endsWith(`.${cookieDomain}`);
}

async function removeCookie(cookie) {
  const domain = cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain;
  const protocol = cookie.secure ? "https:" : "http:";
  const url = `${protocol}//${domain}${cookie.path}`;

  try {
    await chrome.cookies.remove({
      url,
      name: cookie.name,
      storeId: cookie.storeId,
      partitionKey: cookie.partitionKey
    });
    console.log("[Cookies Blocker] Removed cookie", cookie.name, cookie.domain, cookie.path);
  } catch (error) {
    console.warn("[Cookies Blocker] Failed to remove cookie", cookie.name, cookie.domain, error);
  }
}

async function clearTabStorage(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        try {
          window.localStorage?.clear();
        } catch {}

        try {
          window.sessionStorage?.clear();
        } catch {}
      }
    });
  } catch (error) {
    console.warn("[Cookies Blocker] Failed to clear tab storage", error);
  }
}

async function setIconState(tabId, status) {
  const style = ICON_STYLES[status];
  if (!style) {
    return;
  }

  await chrome.action.setIcon({
    tabId,
    imageData: createIconSet(style)
  });
  await chrome.action.setTitle({ tabId, title: style.title });
}

function createIconSet(style) {
  const iconSet = {};
  for (const size of ICON_SIZES) {
    iconSet[size] = drawIcon(size, style);
  }
  return iconSet;
}

function drawIcon(size, style) {
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d");
  const center = size / 2;
  const radius = size * 0.44;

  context.clearRect(0, 0, size, size);
  context.fillStyle = style.background;
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = style.symbolColor;
  context.textAlign = "center";
  context.textBaseline = "middle";

  const fontSize = style.symbol.length >= 3
    ? Math.max(6, Math.floor(size * 0.34))
    : style.symbol.length === 2
      ? Math.max(7, Math.floor(size * 0.42))
      : Math.max(9, Math.floor(size * 0.52));

  context.font = `700 ${fontSize}px sans-serif`;
  context.fillText(style.symbol, center, center + (size <= 16 ? 0.5 : 1));

  return context.getImageData(0, 0, size, size);
}

async function writeTabLog(tabId, entry) {
  const stored = await chrome.storage.local.get(TAB_LOGS_STORAGE_KEY);
  const tabLogs = stored[TAB_LOGS_STORAGE_KEY] || {};

  tabLogs[String(tabId)] = {
    ...entry,
    updatedAt: new Date().toISOString()
  };

  await chrome.storage.local.set({ [TAB_LOGS_STORAGE_KEY]: tabLogs });
}

async function removeTabLog(tabId) {
  const stored = await chrome.storage.local.get(TAB_LOGS_STORAGE_KEY);
  const tabLogs = stored[TAB_LOGS_STORAGE_KEY] || {};
  if (!tabLogs[String(tabId)]) {
    return;
  }

  delete tabLogs[String(tabId)];
  await chrome.storage.local.set({ [TAB_LOGS_STORAGE_KEY]: tabLogs });
}

function getResultMessage(status, mode) {
  if (status === "failure") {
    if (mode === "timeout") {
      return "No matching cookie strategy was found.";
    }

    return "Cookie rejection did not complete.";
  }

  const messages = {
    paused: "Auto-reject is paused for this tab so you can choose consent manually.",
    reset: "Consent data reset. Reloading page.",
    dom: "Rejected cookies using a visible page button.",
    "dom-details": "Opened detailed settings and rejected cookies.",
    "dom-fallback": "Rejected cookies using a page-wide fallback button.",
    "dom-fallback-details": "Opened detailed settings fallback and rejected cookies.",
    onetrust: "Rejected cookies using the OneTrust handler.",
    cookiebot: "Rejected cookies using the Cookiebot handler.",
    didomi: "Rejected cookies using the Didomi handler.",
    fastcmp: "Rejected cookies using the FastCMP handler.",
    usercentrics: "Rejected cookies using the Usercentrics handler."
  };

  return messages[mode] || "Rejected cookies successfully.";
}

async function setPausedAutoReject(tabId, hostname) {
  pausedAutoReject.set(tabId, hostname);
  const stored = await chrome.storage.local.get(PAUSED_AUTO_REJECT_STORAGE_KEY);
  const entries = stored[PAUSED_AUTO_REJECT_STORAGE_KEY] || {};
  entries[String(tabId)] = hostname;
  await chrome.storage.local.set({ [PAUSED_AUTO_REJECT_STORAGE_KEY]: entries });
}

async function clearPausedAutoReject(tabId) {
  pausedAutoReject.delete(tabId);
  const stored = await chrome.storage.local.get(PAUSED_AUTO_REJECT_STORAGE_KEY);
  const entries = stored[PAUSED_AUTO_REJECT_STORAGE_KEY] || {};
  if (!entries[String(tabId)]) {
    return;
  }

  delete entries[String(tabId)];
  await chrome.storage.local.set({ [PAUSED_AUTO_REJECT_STORAGE_KEY]: entries });
}
