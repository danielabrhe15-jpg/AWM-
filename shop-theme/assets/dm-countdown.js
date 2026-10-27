/**
 * dm-countdown.js — `<dm-countdown>` custom element. Single source of
 * truth for both surfaces (storefront `<script src>` + editor `?raw`
 * import — see `src/components/builder/AGENTS.md` "Atom interactivity").
 *
 * Mode: `duration` — target = mountTimestamp + durationSeconds.
 * Per-visitor fresh start on each page load (no localStorage in MVP).
 */
(function () {
  if (window.__dmCountdownInit) return;
  window.__dmCountdownInit = true;

  var FORMAT_UNITS = {
    dhms: ["days", "hours", "minutes", "seconds"],
    hms: ["hours", "minutes", "seconds"],
    hm: ["hours", "minutes"],
    ms: ["minutes", "seconds"],
    s: ["seconds"],
  };

  class DmCountdown extends HTMLElement {
    connectedCallback() {
      if (this.dataset.dmInit) return;
      this.dataset.dmInit = "1";

      var el = this;
      var durationSeconds =
        parseInt(el.getAttribute("data-countdown-duration") || "0", 10) || 0;
      var padDigits =
        (el.getAttribute("data-countdown-pad") || "two") === "two" ? 2 : 1;
      var format = el.getAttribute("data-countdown-format") || "hms";
      var units = FORMAT_UNITS[format] || FORMAT_UNITS.hms;

      var targetMs = Date.now() + durationSeconds * 1000;

      function pad(n) {
        var s = String(n);
        while (s.length < padDigits) s = "0" + s;
        return s;
      }

      function writeAll(key, value) {
        var nodes = el.querySelectorAll('[data-bind="countdown.' + key + '"]');
        for (var i = 0; i < nodes.length; i++) {
          if (nodes[i].textContent !== value) nodes[i].textContent = value;
        }
      }

      function update() {
        var remainingMs = Math.max(0, targetMs - Date.now());
        var totalSeconds = Math.floor(remainingMs / 1000);
        var values = {
          days: Math.floor(totalSeconds / 86400),
          hours: Math.floor((totalSeconds % 86400) / 3600),
          minutes: Math.floor((totalSeconds % 3600) / 60),
          seconds: totalSeconds % 60,
        };

        for (var i = 0; i < units.length; i++) {
          writeAll(units[i], pad(values[units[i]]));
        }

        if (remainingMs <= 0 && el._dmIntervalId) {
          clearInterval(el._dmIntervalId);
          el._dmIntervalId = 0;
        }
      }

      update();
      el._dmIntervalId = setInterval(update, 1000);
    }

    disconnectedCallback() {
      // Stop the timer when the element leaves the DOM so a removed
      // countdown doesn't keep firing setInterval forever.
      if (this._dmIntervalId) {
        clearInterval(this._dmIntervalId);
        this._dmIntervalId = 0;
      }
    }
  }

  customElements.define("dm-countdown", DmCountdown);
})();
