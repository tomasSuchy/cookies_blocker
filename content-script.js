(function () {
  if (window.__cookiesBlockerInitialized) {
    return;
  }
  window.__cookiesBlockerInitialized = true;

  const LOG_PREFIX = "[Cookies Blocker]";
  const CUSTOM_BUTTON_PATTERNS_STORAGE_KEY = "customButtonTextPatterns";
  const CUSTOM_DETAILS_PATTERNS_STORAGE_KEY = "customDetailsTextPatterns";
  const DEFAULT_BUTTON_TEXT_PATTERNS = [
    "odmitnout",
    "odmitnout vse",
    "zamitnout",
    "zamitnout vse",
    "nesouhlasit",
    "nesouhlasim",
    "pouze nezbytne",
    "prijmout jen nezbytne",
    "vse vypnout",
    "reject",
    "only necessary",
    "necessary only",
    "accept essential",
    "accept essential only",
    "accept only essential cookies",
    "deny all",
    "decline",
    "refuse",
  ];
  const DEFAULT_DETAILS_TEXT_PATTERNS = [
    "zobrazit nastaveni",
    "zobrazit podrobnosti",
    "podrobne nastaveni",
    "nastaveni souboru cookies",
    "cookie settings",
    "privacy settings",
    "manage preferences",
    "customize",
    "customise",
  ];
  const CMP_HANDLERS = (window.CookiesBlockerCmpHandlers || []).slice();
  const pageConfig = {
    paused: false,
    siteRule: "default",
    debugEnabled: false
  };
  let buttonTextPatterns = DEFAULT_BUTTON_TEXT_PATTERNS.slice();
  let detailsTextPatterns = DEFAULT_DETAILS_TEXT_PATTERNS.slice();
  let finished = false;
  let runScheduled = false;
  let noMatchLogged = false;
  let timeoutId = null;

  function normalizeText(value) {
    return (value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function looksLikeCookieBanner(element) {
    if (!(element instanceof HTMLElement) || !isVisible(element)) {
      return false;
    }

    const text = normalizeText(element.innerText);
    if (!text) {
      return false;
    }

    const cookieHints = ["cookie", "cookies", "souhlas", "consent", "privacy", "gdpr"];
    return cookieHints.some((hint) => text.includes(hint));
  }

  function getClickableText(element) {
    const beforeContent = getPseudoContent(element, "::before");
    const afterContent = getPseudoContent(element, "::after");
    const aria = element.getAttribute("aria-label");
    const title = element.getAttribute("title");
    const value = "value" in element ? element.value : "";
    return normalizeText([
      element.innerText,
      element.textContent,
      beforeContent,
      afterContent,
      aria,
      title,
      value
    ].filter(Boolean).join(" "));
  }

  function getPseudoContent(element, pseudoElement) {
    try {
      const content = window.getComputedStyle(element, pseudoElement).content;
      if (!content || content === "none" || content === '""' || content === "''") {
        return "";
      }

      return content.replace(/^["']|["']$/g, "");
    } catch {
      return "";
    }
  }

  function findCandidateButton(root) {
    return findButtonByPatterns(root, buttonTextPatterns);
  }

  function findDetailsButton(root) {
    if (!(root instanceof HTMLElement) || !looksLikeCookieBanner(root)) {
      return null;
    }

    return findButtonByPatterns(root, detailsTextPatterns);
  }

  function findButtonByPatterns(root, patterns) {
    const selectors = [
      "button",
      "input[type='button']",
      "input[type='submit']",
      "[role='button']",
      "a[role='button']",
      "a[href]"
    ];
    const elements = root.querySelectorAll(selectors.join(","));

    for (const element of elements) {
      if (!isVisible(element) || !isSafeClickableElement(element)) {
        continue;
      }

      const text = getClickableText(element);
      if (patterns.some((pattern) => text.includes(pattern))) {
        return element;
      }
    }

    return null;
  }

  function isSafeClickableElement(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    if (element instanceof HTMLAnchorElement) {
      const href = (element.getAttribute("href") || "").trim().toLowerCase();
      if (href.startsWith("javascript:")) {
        return false;
      }
    }

    return true;
  }

  function tryDomStrategy() {
    if (pageConfig.siteRule === "cmp-only" || pageConfig.siteRule === "disabled") {
      debugEvent("skip", "dom", `Skipped DOM strategy due to site rule: ${pageConfig.siteRule}`);
      return false;
    }

    const bannerCandidates = Array.from(document.querySelectorAll("body, body *")).filter(looksLikeCookieBanner);

    for (const root of bannerCandidates) {
      const button = findCandidateButton(root);
      if (button) {
        reportResult("success", "dom");
        debugEvent("match", "dom", `Clicked ${describeElement(button)}`);
        button.click();
        console.log(`${LOG_PREFIX} DOM strategy matched`, button);
        return true;
      }
    }

    for (const root of bannerCandidates) {
      const detailsButton = findDetailsButton(root);
      if (!detailsButton) {
        continue;
      }

      detailsButton.click();
      debugEvent("step", "dom-details", `Opened details via ${describeElement(detailsButton)}`);
      console.log(`${LOG_PREFIX} Opened detailed settings`, detailsButton);

      const retryButton = findCandidateButton(root);
      if (retryButton) {
        reportResult("success", "dom-details");
        debugEvent("match", "dom-details", `Clicked ${describeElement(retryButton)}`);
        retryButton.click();
        console.log(`${LOG_PREFIX} DOM strategy matched after opening details`, retryButton);
        return true;
      }
    }

    debugEvent("miss", "dom", "No DOM pattern matched.");
    return false;
  }

  async function tryCmpStrategy() {
    if (pageConfig.siteRule === "dom-only" || pageConfig.siteRule === "disabled") {
      debugEvent("skip", "cmp", `Skipped CMP strategy due to site rule: ${pageConfig.siteRule}`);
      return false;
    }

    for (const handler of CMP_HANDLERS) {
      try {
        if (!handler.matches()) {
          continue;
        }

        debugEvent("step", "cmp", `CMP handler matched: ${handler.id}`);
        const handled = await handler.reject();
        if (handled) {
          console.log(`${LOG_PREFIX} CMP strategy matched ${handler.id}`);
          debugEvent("match", "cmp", `CMP handler succeeded: ${handler.id}`);
          reportResult("success", handler.id);
          return true;
        }
      } catch (error) {
        debugEvent("error", "cmp", `CMP handler failed: ${handler.id}`);
        console.warn(`${LOG_PREFIX} CMP handler failed: ${handler.id}`, error);
      }
    }

    debugEvent("miss", "cmp", "No CMP handler matched.");
    return false;
  }

  async function executeStrategies() {
    if (finished || !document.body) {
      return;
    }

    if (tryDomStrategy()) {
      finished = true;
      return;
    }

    if (await tryCmpStrategy()) {
      finished = true;
      return;
    }

    if (!noMatchLogged) {
      console.log(`${LOG_PREFIX} No matching cookie rejection strategy found`);
      debugEvent("miss", "final", "No matching cookie rejection strategy found.");
      noMatchLogged = true;
    }
  }

  function scheduleRun() {
    if (runScheduled || finished) {
      return;
    }

    runScheduled = true;
    window.setTimeout(() => {
      runScheduled = false;
      void executeStrategies();
    }, 150);
  }

  function reportResult(status, mode) {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }

    const extensionRuntime = globalThis.chrome?.runtime;
    if (!extensionRuntime?.sendMessage) {
      return;
    }

    extensionRuntime.sendMessage({
      type: "cookies-blocker-result",
      status,
      mode
    }).catch(() => {});
  }

  void initialize();

  async function initialize() {
    if (!isSupportedPage()) {
      finished = true;
      return;
    }

    await loadPageConfig();
    await loadCustomPatterns();

    if (pageConfig.paused || pageConfig.siteRule === "disabled") {
      finished = true;
      debugEvent("skip", "init", pageConfig.paused
        ? "Auto-reject is paused for this tab."
        : "Auto-reject is disabled for this site.");
      console.log(`${LOG_PREFIX} Auto-reject is paused or disabled for this tab`);
      return;
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", scheduleRun, { once: true });
    } else {
      scheduleRun();
    }

    const observer = new MutationObserver(() => {
      if (finished) {
        observer.disconnect();
        return;
      }

      scheduleRun();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    window.addEventListener("load", scheduleRun, { once: true });

    timeoutId = window.setTimeout(() => {
      if (finished) {
        return;
      }

      finished = true;
      observer.disconnect();
      debugEvent("failure", "timeout", "Detection timed out without a match.");
      reportResult("failure", "timeout");
    }, 8000);
  }

  async function loadPageConfig() {
    const extensionRuntime = globalThis.chrome?.runtime;
    if (!extensionRuntime?.sendMessage) {
      return;
    }

    try {
      const response = await extensionRuntime.sendMessage({
        type: "cookies-blocker-get-page-config",
        hostname: window.location.hostname
      });
      pageConfig.paused = Boolean(response?.paused);
      pageConfig.siteRule = response?.siteRule || "default";
      pageConfig.debugEnabled = Boolean(response?.debugEnabled);
    } catch {
      pageConfig.paused = false;
      pageConfig.siteRule = "default";
      pageConfig.debugEnabled = false;
    }
  }

  async function loadCustomPatterns() {
    const extensionStorage = globalThis.chrome?.storage?.sync;
    if (!extensionStorage?.get) {
      return;
    }

    try {
      const stored = await extensionStorage.get([
        CUSTOM_BUTTON_PATTERNS_STORAGE_KEY,
        CUSTOM_DETAILS_PATTERNS_STORAGE_KEY
      ]);
      buttonTextPatterns = mergePatterns(
        DEFAULT_BUTTON_TEXT_PATTERNS,
        stored[CUSTOM_BUTTON_PATTERNS_STORAGE_KEY]
      );
      detailsTextPatterns = mergePatterns(
        DEFAULT_DETAILS_TEXT_PATTERNS,
        stored[CUSTOM_DETAILS_PATTERNS_STORAGE_KEY]
      );
    } catch {
      buttonTextPatterns = DEFAULT_BUTTON_TEXT_PATTERNS.slice();
      detailsTextPatterns = DEFAULT_DETAILS_TEXT_PATTERNS.slice();
    }
  }

  function mergePatterns(defaultPatterns, customPatterns) {
    const merged = new Set(defaultPatterns.map(normalizeText));
    if (Array.isArray(customPatterns)) {
      for (const pattern of customPatterns) {
        const normalizedPattern = normalizeText(pattern);
        if (normalizedPattern) {
          merged.add(normalizedPattern);
        }
      }
    }

    return Array.from(merged);
  }

  function isSupportedPage() {
    if (window.location.protocol !== "http:" && window.location.protocol !== "https:") {
      return false;
    }

    if (window.location.hostname === "chromewebstore.google.com") {
      return false;
    }

    return true;
  }

  function describeElement(element) {
    const text = getClickableText(element).slice(0, 80);
    const id = element.id ? `#${element.id}` : "";
    const className = typeof element.className === "string"
      ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((item) => `.${item}`).join("")
      : "";
    return `${element.tagName.toLowerCase()}${id}${className}${text ? ` "${text}"` : ""}`;
  }

  function debugEvent(eventType, strategy, detail) {
    if (!pageConfig.debugEnabled) {
      return;
    }

    const extensionRuntime = globalThis.chrome?.runtime;
    if (!extensionRuntime?.sendMessage) {
      return;
    }

    extensionRuntime.sendMessage({
      type: "cookies-blocker-debug-event",
      hostname: window.location.hostname,
      eventType,
      strategy,
      detail
    }).catch(() => {});
  }
})();
