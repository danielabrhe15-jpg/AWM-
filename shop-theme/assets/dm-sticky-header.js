/**
 * Sticky runtime for Section atoms with `data-section-sticky`. Two jobs:
 *
 *  1. STACKING (all surfaces, incl. the edit canvas) — when several sections
 *     are sticky, each must pin BELOW the ones above it instead of all
 *     overlapping at the top. CSS can't sum sibling heights, so `restack()`
 *     walks the sticky sections in document order and writes a cumulative
 *     `--dm-sticky-top` (sum of the heights of the pinned sections above it)
 *     plus the element's own `--dm-sticky-h`. dm-theme.css reads
 *     `top: var(--dm-sticky-top)`.
 *
 *  2. SCROLL-DIRECTION HIDE — for `sticky-scroll` sections: hide on
 *     scroll-down, reveal on scroll-up by toggling `data-sticky-hidden`
 *     (dm-theme.css slides it to `top: calc(-1 * var(--dm-sticky-h))`). Runs
 *     on every surface, the edit canvas included (WYSIWYG) — the listener is
 *     bound to whichever element actually scrolls.
 *
 * A section "holds the top" (and pushes the next one down) only while pinned:
 * a plain `sticky` always; a `sticky-scroll` only while visible. So when a
 * sticky-scroll hides, the sections below it re-stack upward to fill the gap
 * (`restack()` is re-run on every hide/show flip).
 *
 * Page-level scroll runtime (not atom event-delegation) — the styled element
 * is a plain <section> / Shopify section wrapper with no custom-element host.
 * The scroll listener is capture-phase on `document` so it catches whichever
 * element actually scrolls (the builder's `[data-canvas-root]`, the preview
 * iframe, or the storefront window).
 *
 * Loaded byte-identically on both surfaces: editor via `?raw` import in
 * `canvas/runtime-scripts.ts`, storefront via `<script src>` in
 * `dm-page.liquid`.
 */
(function () {
  if (window.__dmStickyHeaderInit) return;
  window.__dmStickyHeaderInit = true;

  var ALL = '[data-section-sticky]';
  var SCROLLERS = "[data-section-sticky='sticky-scroll']";
  // Permanent (non-sticky-scroll) header sections. Their summed height is the
  // offset any `[data-custom-sticky='below-header']` element pins below —
  // published on :root as `--dm-header-h`. Matches both surfaces: the builder
  // header region and the Shopify header section group.
  var HEADER_PERMANENT =
    '[data-dm-region="header"] [data-section-sticky="sticky"], ' +
    '.shopify-section-group-header-group [data-section-sticky="sticky"]';

  // --- Job 1: stacking + header offset (runs on every surface) ------------
  function restack() {
    var els = document.querySelectorAll(ALL); // querySelectorAll = document order
    var offset = 0;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var h = el.offsetHeight; // unaffected by the `top` translate
      el.style.setProperty('--dm-sticky-h', h + 'px');
      el.style.setProperty('--dm-sticky-top', offset + 'px');
      var mode = el.getAttribute('data-section-sticky');
      var hidden = el.hasAttribute('data-sticky-hidden');
      if (mode === 'sticky' || (mode === 'sticky-scroll' && !hidden)) {
        offset += h;
      }
    }

    // `--dm-header-h`: total height the PERMANENT header occupies at the top —
    // sum of the `sticky` (NOT sticky-scroll, which is ephemeral) header
    // sections. Read by `[data-custom-sticky='below-header']` so any element
    // (e.g. a hero column) pins below the header. Static — permanent-only, so
    // it doesn't shift on scroll, only on resize/mutation.
    var headerH = 0;
    var headerEls = document.querySelectorAll(HEADER_PERMANENT);
    for (var k = 0; k < headerEls.length; k++) headerH += headerEls[k].offsetHeight;
    document.documentElement.style.setProperty('--dm-header-h', headerH + 'px');
  }

  // --- Job 2: scroll-direction hide (preview + storefront) ----------------
  var lastScroll = 0;
  var ticking = false;

  function scrollPos() {
    var root = document.querySelector('[data-canvas-root]');
    if (root) return root.scrollTop || 0;
    return window.scrollY || window.pageYOffset || 0;
  }

  function onScroll() {
    ticking = false;
    var y = scrollPos();
    var hide = y > lastScroll && y > 0; // down (and not at the very top)
    lastScroll = y < 0 ? 0 : y;
    var flipped = false;
    var els = document.querySelectorAll(SCROLLERS);
    for (var i = 0; i < els.length; i++) {
      var was = els[i].hasAttribute('data-sticky-hidden');
      if (hide && !was) {
        els[i].setAttribute('data-sticky-hidden', '');
        flipped = true;
      } else if (!hide && was) {
        els[i].removeAttribute('data-sticky-hidden');
        flipped = true;
      }
    }
    // A hide/show changes which sections hold the top → re-stack the rest.
    if (flipped) restack();
  }

  function requestTick() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(onScroll);
  }

  function init() {
    restack();

    // The editor preview re-renders the tree (json-render re-keys) and the
    // storefront can lazy-add sections — re-stack when <body> changes so new
    // sticky sections are tracked + offsets stay correct. Debounced to one rAF.
    if (window.MutationObserver && document.body) {
      var scheduled = false;
      new MutationObserver(function () {
        if (scheduled) return;
        scheduled = true;
        window.requestAnimationFrame(function () {
          scheduled = false;
          restack();
        });
      }).observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  window.addEventListener('load', restack);
  window.addEventListener('resize', restack);

  // Capture phase so a nested scroller (`[data-canvas-root]`) is caught too.
  // Runs on every surface incl. the edit canvas — WYSIWYG hide-on-scroll.
  document.addEventListener('scroll', requestTick, { passive: true, capture: true });
})();
