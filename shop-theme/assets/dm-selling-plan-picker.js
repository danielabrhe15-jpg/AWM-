/**
 * DropMagic Selling Plan Picker — `<dm-selling-plan-picker>` custom element.
 * Single source for both surfaces (storefront `<script src>` + editor `?raw`
 * import — see `src/components/builder/AGENTS.md` "Atom interactivity").
 *
 * Sibling of dm-option-picker.js for the subscription domain. A picker item
 * carries `data-selling-plan-id="<id>"` (a plan) or `data-one-time="true"`
 * (one-time purchase). Responsibilities (emit-only):
 *   - Per-instance click handler: flip `data-active` across items in this
 *     picker, then emit `dm.setSellingPlan(productId, planId | null)` —
 *     one-time → null. The ATC button reads this from the purchase-state
 *     map in dm-dropmagic.js.
 *   - DOMContentLoaded initial emit: for each picker, emit its initially
 *     active item's plan so the cart state + any bound price display sync
 *     on first paint.
 *
 * A plan is a DIRECT selection — no option-tuple resolution like the option
 * picker. Shares the `[data-option-picker-item]` marker (and its CSS
 * active/hover states); per-custom-element scoping keeps the two pickers'
 * click handlers from cross-firing.
 *
 * Zero `dm.on(...)` calls — reactions live in dm-dropmagic.js.
 */
(function () {
  if (window.__dmSellingPlanPickerInit) return;
  window.__dmSellingPlanPickerInit = true;

  // Plan id for an item, or null for the one-time card.
  function activePlanOf(item) {
    if (item.getAttribute("data-one-time") === "true") return null;
    var id = item.getAttribute("data-selling-plan-id");
    return id ? Number(id) : null;
  }

  function productIdFor(picker, item) {
    return (
      picker.getAttribute("data-dm-product-id") ||
      item.getAttribute("data-dm-product-id") ||
      null
    );
  }

  class DmSellingPlanPicker extends HTMLElement {
    connectedCallback() {
      this.addEventListener("click", this._onClick);
    }
    disconnectedCallback() {
      this.removeEventListener("click", this._onClick);
    }
    _onClick = (e) => {
      var target = e.target;
      if (!target || !target.closest) return;
      // The frequency dropdown inside a subscribe card owns selling-plan
      // selection. Its clicks bubble up here — ignore them, else this handler
      // re-reads the click as a card pick and clobbers the chosen frequency
      // with the card's bound default plan.
      if (target.closest("dm-dropdown")) return;
      var item = target.closest("[data-option-picker-item]");
      if (!item) return;
      // Ignore items bubbling from a nested picker (defensive).
      if (item.closest("dm-selling-plan-picker") !== this) return;

      var items = this.querySelectorAll("[data-option-picker-item]");
      for (var i = 0; i < items.length; i++) {
        items[i].setAttribute(
          "data-active",
          items[i] === item ? "true" : "false",
        );
      }

      var productId = productIdFor(this, item);
      if (productId && window.dropmagic) {
        window.dropmagic.setSellingPlan(productId, activePlanOf(item));
      }
    };
  }

  customElements.define("dm-selling-plan-picker", DmSellingPlanPicker);

  // Initial sync — emit each picker's active selection so the purchase
  // state (and any bound price display) reflects the default on first paint.
  function runInitial() {
    var pickers = document.querySelectorAll(
      "dm-selling-plan-picker[data-dm-product-id]",
    );
    for (var i = 0; i < pickers.length; i++) {
      var picker = pickers[i];
      var productId = picker.getAttribute("data-dm-product-id");
      if (!productId || !window.dropmagic) continue;
      var active = picker.querySelector(
        '[data-option-picker-item][data-active="true"]',
      );
      // Storefront cards render data-active="false"; default to the first
      // non-stale card so a plan is always selected on first paint.
      if (!active) {
        var cards = picker.querySelectorAll("[data-option-picker-item]");
        for (var c = 0; c < cards.length; c++) {
          if (cards[c].getAttribute("data-option-value-stale") === "true") continue;
          active = cards[c];
          break;
        }
        if (active) active.setAttribute("data-active", "true");
      }
      if (!active) continue;
      window.dropmagic.setSellingPlan(productId, activePlanOf(active));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runInitial);
  } else {
    runInitial();
  }
})();
