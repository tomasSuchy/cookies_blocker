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

  function getFastCmpRoot() {
    return document.querySelector("#fast-cmp-container, #fast-cmp-wrapper, #fast-cmp-root");
  }

  function findButton(patterns, root = getFastCmpRoot() || document) {
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

  function clickButton(patterns, root) {
    const button = findButton(patterns, root);
    if (!button) {
      return false;
    }

    button.click();
    return true;
  }

  function rejectFastCmp() {
    const root = getFastCmpRoot() || document;

    if (clickButton(["odmitnout", "reject", "deny", "decline", "refuse"], root)) {
      return true;
    }

    if (clickButton(["preferences", "preference", "podrobne nastaveni", "nastaveni"], root)) {
      return clickButton(
        ["odmitnout vse", "zamitnout vse", "reject all", "deny all", "decline all", "refuse all", "odmitnout"],
        getFastCmpRoot() || document
      );
    }

    return false;
  }

  window.CookiesBlockerCmpHandlers = window.CookiesBlockerCmpHandlers || [];
  window.CookiesBlockerCmpHandlers.push({
    id: "fastcmp",
    matches() {
      return Boolean(
        document.querySelector("#fast-cmp-container, #fast-cmp-wrapper, #fast-cmp-root") ||
        document.querySelector("iframe[title='FastCMP']") ||
        window.location.hostname === "about:blank" && document.querySelector("#fast-cmp-container")
      );
    },
    reject() {
      return rejectFastCmp();
    }
  });
})();
