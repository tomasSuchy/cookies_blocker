(function () {
  function normalizeText(value) {
    return (value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function getButtonText(button) {
    const beforeContent = getPseudoContent(button, "::before");
    const afterContent = getPseudoContent(button, "::after");
    return normalizeText([
      button.innerText,
      button.textContent,
      beforeContent,
      afterContent,
      button.getAttribute("aria-label"),
      button.getAttribute("title"),
      "value" in button ? button.value : ""
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

  function findButtonByText(root, patterns) {
    if (!root) {
      return null;
    }

    const buttons = root.querySelectorAll("button, input[type='button'], input[type='submit'], [role='button']");
    for (const button of buttons) {
      if (!(button instanceof HTMLElement)) {
        continue;
      }

      const text = getButtonText(button);
      if (patterns.some((pattern) => text.includes(pattern))) {
        return button;
      }
    }

    return null;
  }

  function findButtonsByText(root, patterns) {
    if (!root) {
      return [];
    }

    const result = [];
    const buttons = root.querySelectorAll("button, input[type='button'], input[type='submit'], [role='button']");
    for (const button of buttons) {
      if (!(button instanceof HTMLElement)) {
        continue;
      }

      const text = getButtonText(button);
      if (patterns.some((pattern) => text.includes(pattern))) {
        result.push(button);
      }
    }

    return result;
  }

  function getDidomiRoot() {
    return document.querySelector(
      "#didomi-host, .didomi-popup-container, .didomi-consent-popup, [id*='didomi-popup'], [class*='didomi-popup']"
    );
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function clickButtonSequence(root, patterns, maxClicks = 1) {
    let clicked = false;

    for (let attempt = 0; attempt < maxClicks; attempt += 1) {
      const button = findButtonByText(root || getDidomiRoot() || document, patterns);
      if (!button) {
        break;
      }

      button.click();
      clicked = true;
      await sleep(250);
    }

    return clicked;
  }

  async function rejectViaDetailedFlow(root) {
    const detailsClicked = await clickButtonSequence(root, [
      "podrobne nastaveni",
      "detail settings",
      "manage preferences",
      "preferences"
    ]);

    if (!detailsClicked) {
      return false;
    }

    await sleep(350);

    const currentRoot = getDidomiRoot() || root || document;
    const disagreeButtons = findButtonsByText(currentRoot, [
      "nesouhlasit",
      "disagree"
    ]);

    let interacted = false;

    for (const button of disagreeButtons) {
      button.click();
      interacted = true;
      await sleep(120);
    }

    const rejectAllClicked = await clickButtonSequence(getDidomiRoot() || currentRoot, [
      "zamitnout vse",
      "odmitnout vse",
      "disagree to all",
      "reject all"
    ], 2);

    return interacted || rejectAllClicked;
  }

  async function clickDidomiButton() {
    const selectors = [
      "#didomi-notice-disagree-button",
      "#didomi-popup-disagree-all",
      "[id*='didomi'][id*='disagree']",
      "[data-testid='notice-disagree-button']",
      "[data-testid='preferences-disagree-to-all']",
      "[data-testid='disagree-to-all-button']",
      ".didomi-popup-container button"
    ];

    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (button instanceof HTMLElement) {
        const text = getButtonText(button);
        if (!selector.endsWith("button") || text.includes("disagree") || text.includes("reject")) {
          button.click();
          return true;
        }
      }
    }

    const didomiRoot = getDidomiRoot();
    const preferredButton = findButtonByText(didomiRoot || document, [
      "zamitnout vse",
      "odmitnout vse",
      "disagree to all",
      "reject all",
      "disagree & close",
      "nesouhlasit"
    ]);

    if (preferredButton) {
      preferredButton.click();
      return true;
    }

    if (await rejectViaDetailedFlow(didomiRoot || document)) {
      return true;
    }

    return false;
  }

  function rejectViaApi() {
    const didomi = window.Didomi;
    if (!didomi) {
      return false;
    }

    if (typeof didomi.setUserDisagreeToAll === "function") {
      didomi.setUserDisagreeToAll();
      return true;
    }

    if (typeof didomi.notice?.disagree === "function") {
      didomi.notice.disagree();
      return true;
    }

    return false;
  }

  window.CookiesBlockerCmpHandlers = window.CookiesBlockerCmpHandlers || [];
  window.CookiesBlockerCmpHandlers.push({
    id: "didomi",
    matches() {
      return Boolean(
        document.querySelector(
          "#didomi-host, .didomi-popup-container, .didomi-consent-popup, [id*='didomi-popup'], [class*='didomi-popup']"
        ) ||
        window.Didomi
      );
    },
    async reject() {
      return rejectViaApi() || clickDidomiButton();
    }
  });
})();
