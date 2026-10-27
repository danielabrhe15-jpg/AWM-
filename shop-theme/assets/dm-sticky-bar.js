/**
 * dm-sticky-bar.js — reveal-on-scroll for a bottom-fixed bar (the sticky
 * add-to-cart bar). Page-level scroll runtime, NOT a custom element: the bar
 * is a plain Section/Group marked with the `--dm-fx-reveal` effect var (set via
 * customStyles), so there's no host element to hang a class on. Mirrors the
 * shape of dm-sticky-header.js.
 *
 * Effect convention: `--dm-fx-<effect>: <mode>` marks an element; modifiers
 * (`--dm-fx-speed`, `--dm-fx-easing`) are shared knobs read by the CSS in
 * dm-theme.css. Here the CSS starts the bar hidden (translated below the fold)
 * and this runtime toggles `data-dm-fx-active` to reveal it.
 *
 * Behavior: the bar reveals once the page's PRIMARY add-to-cart button — the
 * in-flow buy box, which lives in the product hero — has scrolled ABOVE the
 * viewport, and hides again when it scrolls back into view. We observe exactly
 * ONE sentinel (the first `[data-button-action="add-to-cart"]` that is NOT
 * inside a reveal bar — the bar carries its own ATC), so a page with several
 * ATC buttons (a second hero, bundles, upsells) never flickers: those other
 * buttons are simply not observed.
 *
 * Surfaces:
 *  - Edit canvas (`<html data-dm-edit>`): force the bar visible so it's always
 *    selectable/editable — no scroll behavior there.
 *  - No in-flow ATC at all (isolated block-editor preview, non-product page):
 *    show the bar (nothing to anchor a reveal to).
 *  - View-mode preview + storefront: IntersectionObserver on the sentinel.
 *
 * Loaded byte-identically on both surfaces: editor via `?raw` import in
 * `canvas/runtime-scripts.ts`, storefront via `<script src>` in `dm-page.liquid`.
 */
(function () {
  if (window.__dmStickyBarInit) return;
  window.__dmStickyBarInit = true;

  var BAR = '[style*="--dm-fx-reveal"]';
  var ATC = '[data-button-action="add-to-cart"]';

  function isEdit() {
    return document.documentElement.hasAttribute("data-dm-edit");
  }

  function setup(bar) {
    if (bar.dataset.dmFxInit) return;
    bar.dataset.dmFxInit = "1";

    // Edit canvas — keep the bar fully visible so the merchant can always
    // select + edit it; the scroll reveal only plays on preview/storefront.
    if (isEdit()) {
      bar.setAttribute("data-dm-fx-active", "");
      return;
    }

    // Sentinel = the first add-to-cart button NOT inside a reveal bar. The bar
    // has its own ATC, so we skip any button whose ancestor is a reveal bar.
    var sentinel = null;
    var atcs = document.querySelectorAll(ATC);
    for (var i = 0; i < atcs.length; i++) {
      if (!atcs[i].closest(BAR)) {
        sentinel = atcs[i];
        break;
      }
    }

    // No in-flow buy button (non-product page / isolated preview) → just show it.
    if (!sentinel) {
      bar.setAttribute("data-dm-fx-active", "");
      return;
    }

    // Reveal once the sentinel's BOTTOM edge has scrolled above the viewport top
    // (`boundingClientRect.bottom <= 0`) — i.e. the buy box is behind us, not
    // merely off-screen below at the top of the page. threshold:0 fires on both
    // the exit-top and re-enter transitions, and the initial observe callback
    // sets the correct state if the page loads already scrolled.
    var io = new IntersectionObserver(
      function (entries) {
        for (var j = 0; j < entries.length; j++) {
          if (entries[j].boundingClientRect.bottom <= 0) {
            bar.setAttribute("data-dm-fx-active", "");
          } else {
            bar.removeAttribute("data-dm-fx-active");
          }
        }
      },
      { threshold: 0 },
    );
    io.observe(sentinel);
    bar._dmFxIo = io;
  }

  function scan() {
    var bars = document.querySelectorAll(BAR);
    for (var i = 0; i < bars.length; i++) setup(bars[i]);
  }

  function init() {
    scan();

    // The editor/view iframe portals the tree AFTER this script runs, and the
    // storefront can lazy-add sections — re-scan when <body> changes so a
    // late-mounted bar gets wired. Debounced to one rAF. A re-keyed bar loses
    // its `data-dm-fx-init` with the old DOM node, so it re-initialises cleanly.
    if (window.MutationObserver && document.body) {
      var scheduled = false;
      new MutationObserver(function () {
        if (scheduled) return;
        scheduled = true;
        window.requestAnimationFrame(function () {
          scheduled = false;
          scan();
        });
      }).observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
