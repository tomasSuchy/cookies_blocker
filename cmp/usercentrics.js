(function () {
  function clickUsercentricsButton() {
    const selectors = [
      "#uc-deny-all-button",
      "button[data-testid='uc-deny-all-button']",
      ".uc-deny-all-button"
    ];

    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (button instanceof HTMLElement) {
        button.click();
        return true;
      }
    }

    return false;
  }

  function rejectViaApi() {
    const controller = window.UC_UI;
    if (controller && typeof controller.denyAllConsents === "function") {
      controller.denyAllConsents();
      return true;
    }

    return false;
  }

  window.CookiesBlockerCmpHandlers = window.CookiesBlockerCmpHandlers || [];
  window.CookiesBlockerCmpHandlers.push({
    id: "usercentrics",
    matches() {
      return Boolean(
        document.querySelector("#usercentrics-root, [data-testid='uc-banner-root']") ||
        window.UC_UI ||
        window.usercentrics
      );
    },
    reject() {
      return rejectViaApi() || clickUsercentricsButton();
    }
  });
})();
