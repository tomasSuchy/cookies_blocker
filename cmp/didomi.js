(function () {
  function clickDidomiButton() {
    const selectors = [
      "#didomi-notice-disagree-button",
      "[data-testid='notice-disagree-button']",
      ".didomi-popup-container button"
    ];

    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (button instanceof HTMLElement) {
        const text = (button.innerText || button.textContent || "").toLowerCase();
        if (!selector.endsWith("button") || text.includes("disagree") || text.includes("reject")) {
          button.click();
          return true;
        }
      }
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
        document.querySelector("#didomi-host, .didomi-popup-container") ||
        window.Didomi
      );
    },
    reject() {
      return rejectViaApi() || clickDidomiButton();
    }
  });
})();
