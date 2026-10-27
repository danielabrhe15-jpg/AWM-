/**
 * dm-marquee.js — `<dm-marquee>` custom element. Single source of truth
 * for both surfaces (storefront `<script src>` + editor `?raw` import —
 * see `src/components/builder/AGENTS.md` "Atom interactivity").
 */
(function () {
  if (window.__dmMarqueeInit) return;
  window.__dmMarqueeInit = true;

  var speedMap = {
    "very-slow": 20,
    slow: 35,
    normal: 50,
    fast: 80,
    "very-fast": 120,
  };

  // Hard ceiling on clones — see the React mirror in
  // `src/components/builder/blocks/atoms/marquee/runtime.ts` for rationale.
  var MAX_COPIES = 50;

  class DmMarquee extends HTMLElement {
    connectedCallback() {
      if (this.dataset.dmInit) return;
      var track = this.querySelector(".dm-marquee-track");
      if (!track) return;
      this.dataset.dmInit = "1";

      var el = this;
      this._dmTrack = track;

      var speedAttr = el.getAttribute("data-marquee-speed") || "normal";
      var speedPx = speedMap[speedAttr] || parseInt(speedAttr) || 50;
      var direction = el.getAttribute("data-marquee-direction") || "left";
      var isVertical = direction === "up" || direction === "down";

      // Strip stale clones (e.g. from a remount that left them behind) —
      // otherwise we'd treat clones as originals and clone the clones,
      // exploding the DOM.
      var stalePre = track.querySelectorAll("[data-marquee-clone]");
      for (var sp = 0; sp < stalePre.length; sp++) stalePre[sp].remove();

      // The authored children: every track child that isn't a copy we made.
      // Recomputed on EVERY pass rather than snapshotted once — a snapshot
      // goes stale as soon as the child list changes, and then clones ghosts
      // of removed nodes back into the loop.
      function readOriginals() {
        var out = [];
        for (var i = 0; i < track.children.length; i++) {
          var child = track.children[i];
          if (!child.hasAttribute("data-marquee-clone")) out.push(child);
        }
        return out;
      }

      var mo = null;

      function layout() {
        // Strip clones FIRST so neither measurement includes them. With
        // `width: max-content` on the track and `width: 100%` on
        // `<dm-marquee>`, an unconstrained ancestor lets the container
        // expand to fit the cloned track — measuring `clientWidth` before
        // the strip would yield the inflated size and balloon the copy
        // count on the next pass.
        var stale = track.querySelectorAll("[data-marquee-clone]");
        for (var i = 0; i < stale.length; i++) stale[i].remove();
        var originals = readOriginals();
        // Nothing to loop YET — content may still be arriving. Bail out of
        // this pass only; the observers stay armed so the pass that matters
        // runs when it lands.
        if (originals.length === 0) return;
        var containerSize = isVertical ? el.clientHeight : el.clientWidth;
        var originalSize = isVertical
          ? track.scrollHeight
          : track.scrollWidth;
        if (originalSize === 0 || containerSize === 0) return;

        // The track is a flex row/column with a uniform gap, so its
        // visual pattern repeats every `period` px — one set of
        // originals plus the gap that trails it. Shifting the track by
        // exactly one period loops with zero seam (see the
        // `--dm-marquee-shift` keyframe in dm-theme.css). Measuring the
        // gap is what makes it exact: a plain -50% translate is always
        // off by half a gap.
        var cs = getComputedStyle(track);
        var gap =
          parseFloat(isVertical ? cs.rowGap : cs.columnGap) || 0;
        var period = originalSize + gap;

        // Smallest copy count that keeps the viewport covered after the
        // track shifts one whole period. Capped at MAX_COPIES.
        var copies = Math.min(
          MAX_COPIES,
          Math.max(2, Math.ceil((containerSize + gap) / period) + 1),
        );
        var fragment = document.createDocumentFragment();
        for (var c = 1; c < copies; c++) {
          for (var k = 0; k < originals.length; k++) {
            var clone = originals[k].cloneNode(true);
            clone.setAttribute("data-marquee-clone", "true");
            fragment.appendChild(clone);
          }
        }
        track.appendChild(fragment);

        // Drive the keyframe distance and the duration off the same
        // period so the scroll speed stays constant: period ÷ speedPx.
        track.style.setProperty("--dm-marquee-shift", period + "px");
        track.style.animationDuration = period / speedPx + "s";

        // Drop the strip + append we just performed. The observer watches the
        // whole track, so without this every pass would schedule the next one.
        if (mo) mo.takeRecords();
      }

      var rafId = 0;
      var scheduleLayout = function () {
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(layout);
      };
      this._dmCancelRaf = function () {
        cancelAnimationFrame(rafId);
      };

      scheduleLayout();

      // Container resize → relayout. rAF-deferred to avoid the
      // "ResizeObserver loop completed with undelivered notifications" warning.
      if (window.ResizeObserver) {
        this._dmRo = new ResizeObserver(scheduleLayout);
        this._dmRo.observe(el);
      }

      // One observer on the TRACK: async content (icon SVG insertion, image
      // src swap), text rewritten in place (`characterData` — assigning
      // `nodeValue` is not a childList mutation), and children added or
      // removed (`childList` on the track itself, which per-original
      // observers could not see). Watching our own output is fine — every
      // pass ends with `takeRecords()`. MutationObserver fires on DOM
      // mutations, NOT on layout-driven size changes, so it can't feedback-
      // loop the way a ResizeObserver on the children would.
      if (window.MutationObserver) {
        mo = new MutationObserver(scheduleLayout);
        this._dmMo = mo;
        mo.observe(track, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        });
      }

      // Pause animation when offscreen. Clear the inline value when back
      // onscreen instead of setting "running" — inline overrides the CSS
      // `:hover { paused }` rule and breaks pause-on-hover.
      if (window.IntersectionObserver) {
        this._dmIo = new IntersectionObserver(
          function (entries) {
            for (var i = 0; i < entries.length; i++) {
              if (entries[i].isIntersecting) {
                track.style.removeProperty("animation-play-state");
              } else {
                track.style.animationPlayState = "paused";
              }
            }
          },
          { rootMargin: "100px" },
        );
        this._dmIo.observe(el);
      }
    }

    disconnectedCallback() {
      if (this._dmCancelRaf) this._dmCancelRaf();
      if (this._dmRo) {
        this._dmRo.disconnect();
        this._dmRo = null;
      }
      if (this._dmMo) {
        this._dmMo.disconnect();
        this._dmMo = null;
      }
      if (this._dmIo) {
        this._dmIo.disconnect();
        this._dmIo = null;
      }
    }
  }

  customElements.define("dm-marquee", DmMarquee);
})();
