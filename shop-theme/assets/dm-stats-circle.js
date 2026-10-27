/**
 * dm-stats-circle.js — `<dm-stats-circle>` custom element. Single source
 * of truth for both surfaces (storefront `<script src>` + editor `?raw`
 * import — see `src/components/builder/AGENTS.md` "Atom interactivity").
 *
 * Liquid / React renders the ring with the full target value as the
 * initial `--dm-stats-circle-percentage` (graceful no-JS fallback). On
 * connect, we snap every animated ring to 0 — disabling the CSS
 * transition for the snap so it's instantaneous — then restore the
 * captured target on viewport entry, with the transition re-enabled
 * so the 1s ease-out plays.
 *
 * Skips elements that aren't `data-stats-animated='on-appear'` — those
 * render statically with no JS-driven animation.
 */
(function () {
  if (window.__dmStatsCircleInit) return;
  window.__dmStatsCircleInit = true;

  class DmStatsCircle extends HTMLElement {
    connectedCallback() {
      if (this.dataset.dmInit) return;
      if (this.getAttribute("data-stats-animated") !== "on-appear") return;
      this.dataset.dmInit = "1";

      var el = this;
      var fill = el.querySelector("[data-stats-fill]");
      if (!fill) return;

      var target = el.getAttribute("data-stats-percentage") || "0";

      // Snap to 0 with the transition disabled — otherwise the ring would
      // visibly animate from target → 0 → target, which is the opposite of
      // what we want.
      var prev = fill.style.transition;
      fill.style.transition = "none";
      el.style.setProperty("--dm-stats-circle-percentage", "0");
      // Force reflow so the "0" snap commits before the transition is
      // restored (otherwise the browser batches and skips the snap).
      void fill.offsetWidth;
      fill.style.transition = prev;

      this._dmIo = new IntersectionObserver(
        function (entries) {
          for (var i = 0; i < entries.length; i++) {
            if (entries[i].isIntersecting) {
              requestAnimationFrame(function () {
                el.style.setProperty(
                  "--dm-stats-circle-percentage",
                  target,
                );
              });
              el._dmIo.unobserve(entries[i].target);
            }
          }
        },
        { threshold: 0.3 },
      );
      this._dmIo.observe(el);
    }

    disconnectedCallback() {
      if (this._dmIo) {
        this._dmIo.disconnect();
        this._dmIo = null;
      }
    }
  }

  customElements.define("dm-stats-circle", DmStatsCircle);
})();
