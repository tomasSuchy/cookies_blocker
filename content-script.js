(function () {
  if (window.__cookiesBlockerInitialized) {
    return;
  }
  window.__cookiesBlockerInitialized = true;

  const LOG_PREFIX = "[Cookies Blocker]";
  const BUTTON_TEXT_PATTERNS = [
    "odmitnout",
    "odmitnout vse",
    "zamitnout",
    "zamitnout vse",
    "nesouhlasit",
    "nesouhlasim",
    "pouze nezbytne",
    "vse vypnout",
    "reject",
    "only necessary",
    "necessary only",
    "deny all",
    "decline",
    "refuse",
  ];
  const DETAILS_TEXT_PATTERNS = [
    "podrobne nastaveni",
    "nastaveni souboru cookies",
    "cookie settings",
    "privacy settings",
    "details",
    "preferences",
    "manage preferences",
    "customize",
    "customise",
  ];
  const CMP_HANDLERS = (window.CookiesBlockerCmpHandlers || []).slice();
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
    return findButtonByPatterns(root, BUTTON_TEXT_PATTERNS);
  }

  function findDetailsButton(root) {
    if (!(root instanceof HTMLElement) || !looksLikeCookieBanner(root)) {
      return null;
    }

    return findButtonByPatterns(root, DETAILS_TEXT_PATTERNS);
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
    const bannerCandidates = Array.from(document.querySelectorAll("body, body *")).filter(looksLikeCookieBanner);

    for (const root of bannerCandidates) {
      const button = findCandidateButton(root);
      if (button) {
        reportResult("success", "dom");
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
      console.log(`${LOG_PREFIX} Opened detailed settings`, detailsButton);

      const retryButton = findCandidateButton(root);
      if (retryButton) {
        reportResult("success", "dom-details");
        retryButton.click();
        console.log(`${LOG_PREFIX} DOM strategy matched after opening details`, retryButton);
        return true;
      }
    }

    const fallbackButton = findCandidateButton(document.body);
    if (fallbackButton) {
      reportResult("success", "dom-fallback");
      fallbackButton.click();
      console.log(`${LOG_PREFIX} DOM fallback matched`, fallbackButton);
      return true;
    }

    return false;
  }

  async function tryCmpStrategy() {
    for (const handler of CMP_HANDLERS) {
      try {
        if (!handler.matches()) {
          continue;
        }

        const handled = await handler.reject();
        if (handled) {
          console.log(`${LOG_PREFIX} CMP strategy matched ${handler.id}`);
          reportResult("success", handler.id);
          return true;
        }
      } catch (error) {
        console.warn(`${LOG_PREFIX} CMP handler failed: ${handler.id}`, error);
      }
    }

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
      console.warn(`${LOG_PREFIX} Extension messaging API is unavailable`);
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
    if (await isAutoRejectPaused()) {
      finished = true;
      console.log(`${LOG_PREFIX} Auto-reject is paused for this tab`);
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
      reportResult("failure", "timeout");
    }, 8000);
  }

  async function isAutoRejectPaused() {
    const extensionRuntime = globalThis.chrome?.runtime;
    if (!extensionRuntime?.sendMessage) {
      return false;
    }

    try {
      const response = await extensionRuntime.sendMessage({
        type: "cookies-blocker-is-paused",
        hostname: window.location.hostname
      });
      return Boolean(response?.paused);
    } catch {
      return false;
    }
  }
})();
