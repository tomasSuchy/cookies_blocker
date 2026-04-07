(function () {
  function clickCookiebotButton() {
    const selectors = [
      "#CybotCookiebotDialogBodyButtonDecline",
      "#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll",
      "[data-cookieconsent='decline']"
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
    const bot = window.Cookiebot;
    if (!bot) {
      return false;
    }

    if (typeof bot.submitCustomConsent === "function") {
      bot.submitCustomConsent(false, false, false);
      if (typeof bot.hide === "function") {
        bot.hide();
      }
      return true;
    }

    if (typeof bot.decline === "function") {
      bot.decline();
      return true;
    }

    return false;
  }

  window.CookiesBlockerCmpHandlers = window.CookiesBlockerCmpHandlers || [];
  window.CookiesBlockerCmpHandlers.push({
    id: "cookiebot",
    matches() {
      return Boolean(
        document.querySelector("#CybotCookiebotDialog") ||
        window.Cookiebot
      );
    },
    reject() {
      return rejectViaApi() || clickCookiebotButton();
    }
  });
})();
