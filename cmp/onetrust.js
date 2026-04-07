(function () {
  function clickOneTrustButton() {
    const selectors = [
      "#onetrust-reject-all-handler",
      "button[aria-label*='Reject']",
      "button[aria-label*='Only necessary']"
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
    const oneTrust = window.OneTrust;
    if (!oneTrust) {
      return false;
    }

    if (typeof oneTrust.RejectAll === "function") {
      oneTrust.RejectAll();
      return true;
    }

    return false;
  }

  window.CookiesBlockerCmpHandlers = window.CookiesBlockerCmpHandlers || [];
  window.CookiesBlockerCmpHandlers.push({
    id: "onetrust",
    matches() {
      return Boolean(
        document.querySelector("#onetrust-banner-sdk, #onetrust-consent-sdk") ||
        window.OneTrust
      );
    },
    reject() {
      return rejectViaApi() || clickOneTrustButton();
    }
  });
})();
