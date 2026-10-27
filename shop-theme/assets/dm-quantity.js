/**
 * DropMagic Quantity — `<dm-quantity>` provider custom element. Single source
 * for both surfaces (storefront `<script src>` + editor `?raw` import — see
 * `src/components/builder/AGENTS.md` "Atom interactivity").
 *
 * The stepper is composed of child atoms: two Buttons with
 * `action="quantity-decrease"` / `"quantity-increase"` (→ Icon) flanking a
 * Text bound `quantity`. This element OWNS the behavior: it delegates the
 * button clicks, clamps to `[min, max]` (step), rewrites the `quantity`-bound
 * Text, and emits `dm.setQuantity(productId, qty)` — consumed by
 * dm-dropmagic.js's per-product purchase state + ATC. Emit-only otherwise.
 *
 * (ATC's own delegation keys on `data-button-action="add-to-cart"`, so the
 * quantity buttons never trigger it.)
 */
(function () {
  if (window.__dmQuantityInit) return;
  window.__dmQuantityInit = true;

  function clampQty(n, min, max) {
    if (isFinite(min) && n < min) n = min;
    if (isFinite(max) && max > 0 && n > max) n = max;
    return n;
  }

  class DmQuantity extends HTMLElement {
    connectedCallback() {
      this.addEventListener("click", this._onClick);
    }
    disconnectedCallback() {
      this.removeEventListener("click", this._onClick);
    }
    _onClick = (e) => {
      var target = e.target;
      if (!target || !target.closest) return;
      var btn = target.closest(
        '[data-button-action="quantity-increase"], [data-button-action="quantity-decrease"]',
      );
      if (!btn || btn.closest("dm-quantity") !== this) return;
      e.preventDefault();
      var inc = btn.getAttribute("data-button-action") === "quantity-increase";

      var valueEl = this.querySelector('[data-bind="quantity"]');
      if (!valueEl) return;

      var min = parseInt(this.getAttribute("data-quantity-min"), 10);
      var max = parseInt(this.getAttribute("data-quantity-max"), 10);
      var step = parseInt(this.getAttribute("data-quantity-step"), 10);
      if (!isFinite(min)) min = 1;
      if (!isFinite(step) || step < 1) step = 1;

      var current = parseInt(valueEl.textContent, 10);
      if (!isFinite(current)) current = min;
      var next = clampQty(current + (inc ? step : -step), min, max);
      if (next === current) return;
      valueEl.textContent = String(next);

      var productId = this.getAttribute("data-dm-product-id");
      if (productId && window.dropmagic) {
        window.dropmagic.setQuantity(productId, next);
      }
    };
  }

  customElements.define("dm-quantity", DmQuantity);

  // A stepper in CART mode drives one cart LINE, not the product's purchase
  // quantity — the `quantity-stepper` molecule's `action` param swaps its
  // buttons to `cart-*` and dm-cart.js takes over the clicks. Its number is
  // that line's quantity (`line.quantity`), so feeding it to setQuantity would
  // make the product's ATC add "whatever is already in the cart".
  //
  // Keyed on the buttons rather than on a drawer/cart-line ancestor because the
  // button action IS the mode switch: a Default-mode stepper placed inside a
  // drawer (an upsell) legitimately drives product quantity, and a cart-mode
  // one outside a line still must not.
  function isCartMode(el) {
    return !!el.querySelector(
      '[data-button-action="cart-increase"], [data-button-action="cart-decrease"]',
    );
  }

  // Initial emit — each stepper's starting value (its `quantity` Text content)
  // into the purchase state, so an untouched stepper still sends the intended
  // quantity (the ATC fallback is 1, but be explicit).
  function runInitial() {
    var steppers = document.querySelectorAll("dm-quantity[data-dm-product-id]");
    for (var i = 0; i < steppers.length; i++) {
      var el = steppers[i];
      if (isCartMode(el)) continue;
      var productId = el.getAttribute("data-dm-product-id");
      var valueEl = el.querySelector('[data-bind="quantity"]');
      if (!productId || !valueEl || !window.dropmagic) continue;
      var v = parseInt(valueEl.textContent, 10);
      if (isFinite(v)) window.dropmagic.setQuantity(productId, v);
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runInitial);
  } else {
    runInitial();
  }
})();
