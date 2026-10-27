/**
 * DropMagic Bundle — `<dm-bundle>` custom element. Selection-only component
 * (emit-only, per the centralized-reception rule): a bar-card click flips the
 * active tier and emits `dm:bundle-selected`. ALL reception — repricing the bar
 * cards from the live variant and recording the chosen tier for add-to-cart —
 * lives in dm-dropmagic.js, like every other atom's reactions.
 *
 * Published DOM (see dm-bundle.liquid + the dm-card.liquid bar stamp):
 *
 *   <dm-bundle data-bundle-id data-bars='{currency,items:[BarItem,…]}' data-dm-product-id>
 *     <dm-card data-bundle-bar data-bar-id data-active> … </dm-card>  ← one per tier
 *     <dm-card data-bundle-bar data-bar-id data-active> … </dm-card>
 *   </dm-bundle>
 *
 * `data-bars` is the resolved `shop_discounts.bar_items` JSON, baked at publish
 * so the runtime prices + builds cart lines with no storefront DB call.
 *
 * Cart contract (the discount Function uses the `bundles`/`extraBars` config,
 * which selects the discount by the line's `_bar_id` = the PICKED tier; so
 * mixed QB+bxgy bundles + same-quantity tiers resolve correctly):
 *   QB   → 1 line  qty=tier.quantity   props {_bundle_type:"quantity-breaks", _bar_id}
 *   bxgy → 1 "get" line (qty=getQty) + 1 "buy" line (qty=buyQty),
 *          props {_bundle_type:"get"|"buy", _bar_id}; GET first (the `bundles`
 *          path discounts the GET line). `_bar_id` drives the discount; the
 *          quantities are the cart contents (a Function can't add products).
 * The line build + POST live in dm-dropmagic.js's `addToCart`; this file only
 * selects and announces.
 *
 * Plain ES2017, IIFE-wrapped, idempotent. Zero `dm.on(...)` — reactions are
 * central in dm-dropmagic.js.
 */
(function () {
  if (window.__dmBundleInit) return;
  window.__dmBundleInit = true;

  // The edit canvas sets `data-dm-edit` on <html>. There, clicks select the
  // atom and React renders the active bar (bundleManualStamp) + prices (text
  // render.tsx) — so this runtime stays a no-op.
  function isEdit() {
    return document.documentElement.hasAttribute("data-dm-edit");
  }

  // Flip data-active across this bundle's bar cards, then announce the choice.
  // dm-dropmagic.js records it (for add-to-cart) and reprices the cards.
  function selectBar(bundleEl, card) {
    var cards = bundleEl.querySelectorAll("[data-bundle-bar]");
    for (var i = 0; i < cards.length; i++) {
      cards[i].setAttribute("data-active", cards[i] === card ? "true" : "false");
    }
    if (!window.dropmagic) return;
    window.dropmagic.emit("dm:bundle-selected", {
      productId: bundleEl.getAttribute("data-dm-product-id") || null,
      bundleId: bundleEl.getAttribute("data-bundle-id") || null,
      barId: card.getAttribute("data-bar-id") || null,
    });
  }

  class DmBundle extends HTMLElement {
    connectedCallback() {
      this.addEventListener("click", this._onClick);
    }
    disconnectedCallback() {
      this.removeEventListener("click", this._onClick);
    }
    _onClick = (e) => {
      if (isEdit()) return;
      var target = e.target;
      if (!target || !target.closest) return;
      var card = target.closest("[data-bundle-bar]");
      // Ignore clicks bubbling from a card in a NESTED bundle (defensive).
      if (!card || card.closest("dm-bundle") !== this) return;
      selectBar(this, card);
    };
  }

  customElements.define("dm-bundle", DmBundle);

  // Initial selection — one pass once the DOM (+ product blobs) is parsed.
  // Page-scoped (not per connectedCallback) so the product JSON blob and every
  // bar card are guaranteed present. Pick the preselected bar
  // (`data-bars[].isPreselected`) or the first card, mark it active, and emit —
  // dm-dropmagic.js then records the tier + prices the bars on first paint.
  function runInitial() {
    if (isEdit()) return;
    var bundles = document.querySelectorAll("dm-bundle");
    for (var i = 0; i < bundles.length; i++) {
      var el = bundles[i];
      var cards = el.querySelectorAll("[data-bundle-bar]");
      if (!cards.length) continue;

      var preselectedId = null;
      try {
        // Two shapes: `{currency, items}` since bars started carrying the
        // currency they were baked in, a bare array on pages published before
        // that. Selection is currency-blind either way — pricing lives in
        // dm-dropmagic.js — but the array walk must not iterate the envelope.
        var raw = JSON.parse(el.getAttribute("data-bars") || "[]");
        var bars = Array.isArray(raw) ? raw : (raw && raw.items) || [];
        for (var b = 0; b < bars.length; b++) {
          if (bars[b] && bars[b].isPreselected) {
            preselectedId = bars[b].id;
            break;
          }
        }
      } catch (_) {}

      var chosen = null;
      if (preselectedId) {
        for (var c = 0; c < cards.length; c++) {
          if (cards[c].getAttribute("data-bar-id") === preselectedId) {
            chosen = cards[c];
            break;
          }
        }
      }
      selectBar(el, chosen || cards[0]);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runInitial);
  } else {
    runInitial();
  }
})();
