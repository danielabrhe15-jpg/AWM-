/**
 * dm-progress-bar.js — `<dm-progress-bar>` custom element. Single source
 * of truth for both surfaces (storefront `<script src>` + editor `?raw`
 * import — see `src/components/builder/AGENTS.md` "Atom interactivity").
 *
 * Mode: `duration` — target = mountTimestamp + durationSeconds.
 * Direction: "drain" (scaleX = remaining/total) or "fill" (scaleX = elapsed/total).
 */
(function () {
  if (window.__dmProgressBarInit) return;
  window.__dmProgressBarInit = true;

  class DmProgressBar extends HTMLElement {
    connectedCallback() {
      if (this.dataset.dmInit) return;
      this.dataset.dmInit = "1";

      // cart-goal + static sources — static fills set inline by Liquid
      // (cart-goal also re-renders via the Section Rendering API when
      // dm-cart.js refreshes the drawer). No time tick; bail so the duration
      // loop never clobbers them. Mirrors the React runtime gate
      // (progress-bar/runtime.ts).
      var source = this.getAttribute("data-progress-source");
      if (source === "cart-goal" || source === "static") return;

      var el = this;
      var fill = el.querySelector("[data-progress-fill]");
      if (!fill) return;

      var durationSeconds =
        parseInt(el.getAttribute("data-progress-duration") || "0", 10) || 0;
      var direction = el.getAttribute("data-progress-mode") || "drain";

      var totalMs = durationSeconds * 1000;
      var targetMs = Date.now() + totalMs;

      fill.style.transformOrigin = "left center";

      function update() {
        var remainingMs = Math.max(0, targetMs - Date.now());
        var elapsedMs = Math.min(totalMs, totalMs - remainingMs);
        var ratio =
          totalMs <= 0
            ? 0
            : direction === "drain"
            ? remainingMs / totalMs
            : elapsedMs / totalMs;
        fill.style.transform = "scaleX(" + ratio + ")";

        if (remainingMs <= 0 && el._dmIntervalId) {
          clearInterval(el._dmIntervalId);
          el._dmIntervalId = 0;
        }
      }

      update();
      el._dmIntervalId = setInterval(update, 1000);
    }

    disconnectedCallback() {
      if (this._dmIntervalId) {
        clearInterval(this._dmIntervalId);
        this._dmIntervalId = 0;
      }
    }
  }

  customElements.define("dm-progress-bar", DmProgressBar);
})();
