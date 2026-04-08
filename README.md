# Cookies Blocker

Chrome extension (Manifest V3), která automaticky odmítá cookie bannery a volitelně smaže cookies při odchodu z domény.

Ikona v toolbaru:

* `...` = detekce právě běží
* `OK` = odmítnutí proběhlo úspěšně
* `NO` = nenašla se použitelná strategie

## Instalace

1. Otevři `chrome://extensions`.
2. Zapni `Developer mode`.
3. Klikni na `Load unpacked`.
4. Vyber složku `c:\work\cookies_blocker`.

## Poznámky k omezením

* Bannery uvnitř cross-origin iframe nemusí být přístupné content scriptu.
* Některé weby používají vlastní CMP nebo nestandardní texty tlačítek, takže nemusí být pokryté.
* Cleanup řeší jen cookies přes `chrome.cookies`; nemaže `localStorage`, `sessionStorage` ani IndexedDB.
