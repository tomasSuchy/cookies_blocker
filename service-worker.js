const CLEANUP_STORAGE_KEY = "cleanupOnDomainExit";
const DEFAULT_CLEANUP_ENABLED = false;
const tabHostnames = new Map();
const INJECTED_FILES = [
  "cmp/onetrust.js",
  "cmp/cookiebot.js",
  "cmp/didomi.js",
  "cmp/usercentrics.js",
  "content-script.js"
];

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
    return;
  }

  tabHostnames.set(details.tabId, nextHostname);

  if (previousHostname && previousHostname !== nextHostname && await isCleanupEnabled()) {
    await clearCookiesForHostname(previousHostname);
  }
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

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: INJECTED_FILES
    });
  } catch (error) {
    console.warn("[Cookies Blocker] Failed to inject scripts", tab.url, error);
  }
});

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
