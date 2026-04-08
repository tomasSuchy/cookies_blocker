(function () {
  if (window.__cookiesBlockerInitialized) {
    return;
  }
  window.__cookiesBlockerInitialized = true;

  const LOG_PREFIX = "[Cookies Blocker]";
  const BUTTON_TEXT_PATTERNS = [
    "reject",
    "odmitnout",
    "odmitnout vse",
    "zamitnout",
    "zamitnout vse",
    "nesouhlasit",
    "only necessary",
    "pouze nezbytne",
    "necessary only",
    "nesouhlasit"
  ];
  const DETAILS_TEXT_PATTERNS = [
    "podrobne nastaveni",
    "details",
    "preferences",
    "manage preferences",
    "customize",
    "customise"
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
    const aria = element.getAttribute("aria-label");
    const title = element.getAttribute("title");
    const value = "value" in element ? element.value : "";
    return normalizeText([element.innerText, aria, title, value].filter(Boolean).join(" "));
  }

  function findCandidateButton(root) {
    return findButtonByPatterns(root, BUTTON_TEXT_PATTERNS);
  }

  function findDetailsButton(root) {
    return findButtonByPatterns(root, DETAILS_TEXT_PATTERNS);
  }

  function findButtonByPatterns(root, patterns) {
    const selectors = [
      "button",
      "input[type='button']",
      "input[type='submit']",
      "[role='button']",
      "[tabindex]"
    ];
    const elements = root.querySelectorAll(selectors.join(","));

    for (const element of elements) {
      if (!isVisible(element)) {
        continue;
      }

      const text = getClickableText(element);
      if (patterns.some((pattern) => text.includes(pattern))) {
        return element;
      }
    }

    return null;
  }

  function tryDomStrategy() {
    const bannerCandidates = Array.from(document.querySelectorAll("body, body *")).filter(looksLikeCookieBanner);

    for (const root of bannerCandidates) {
      const button = findCandidateButton(root);
      if (button) {
        button.click();
        console.log(`${LOG_PREFIX} DOM strategy matched`, button);
        reportResult("success", "dom");
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

      const retryButton = findCandidateButton(root) || findCandidateButton(document.body);
      if (retryButton) {
        retryButton.click();
        console.log(`${LOG_PREFIX} DOM strategy matched after opening details`, retryButton);
        reportResult("success", "dom-details");
        return true;
      }
    }

    const fallbackButton = findCandidateButton(document.body);
    if (fallbackButton) {
      fallbackButton.click();
      console.log(`${LOG_PREFIX} DOM fallback matched`, fallbackButton);
      reportResult("success", "dom-fallback");
      return true;
    }

    const fallbackDetailsButton = findDetailsButton(document.body);
    if (fallbackDetailsButton) {
      fallbackDetailsButton.click();
      console.log(`${LOG_PREFIX} Opened detailed settings fallback`, fallbackDetailsButton);

      const retryButton = findCandidateButton(document.body);
      if (retryButton) {
        retryButton.click();
        console.log(`${LOG_PREFIX} DOM fallback matched after opening details`, retryButton);
        reportResult("success", "dom-fallback-details");
        return true;
      }
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

    chrome.runtime.sendMessage({
      type: "cookies-blocker-result",
      status,
      mode
    }).catch(() => {});
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
})();
