/**
 * DropMagic Checkbox — `<dm-checkbox>` provider custom element. Single source
 * for both surfaces (storefront `<script src>` + editor `?raw` import — see
 * `src/components/builder/AGENTS.md` "Atom interactivity").
 *
 * The clickable provider (the `<label>` equivalent): a flex container holding a
 * CheckboxIndicator (pure-CSS box+check that reacts to this element's
 * `data-checked`) plus label/content. Clicking anywhere flips `data-checked`
 * and emits `dm:checkbox-changed { value, checked }`. With
 * `data-checkbox-action="toggle-subscription"` it ALSO drives the cart:
 * checked → `dm.setSellingPlan(productId, planId)`, unchecked → null
 * (one-time). Emit-only otherwise — cross-cutting reactions live in
 * dm-dropmagic.js.
 */
(function () {
  if (window.__dmCheckboxInit) return;
  window.__dmCheckboxInit = true;

  // When this is a subscription toggle, push the cart's selling plan: the
  // stamped plan id when checked, null (one-time) when unchecked. The ATC
  // button reads it from the purchase-state map in dm-dropmagic.js.
  function applySubscription(el, checked) {
    if (el.getAttribute("data-checkbox-action") !== "toggle-subscription") {
      return;
    }
    var productId = el.getAttribute("data-dm-product-id");
    if (!productId || !window.dropmagic) return;
    var planAttr = el.getAttribute("data-selling-plan-id");
    var planId = checked && planAttr ? Number(planAttr) : null;
    window.dropmagic.setSellingPlan(productId, planId);
  }

  class DmCheckbox extends HTMLElement {
    connectedCallback() {
      this.addEventListener("click", this._onClick);
    }
    disconnectedCallback() {
      this.removeEventListener("click", this._onClick);
    }
    _onClick = (e) => {
      // The whole element is the toggle (mirrors a <label>). If the click
      // bubbled from a nested dm-checkbox, let the innermost own it.
      var target = e.target;
      if (target && target.closest && target.closest("dm-checkbox") !== this) {
        return;
      }
      var checked = this.getAttribute("data-checked") !== "true";
      this.setAttribute("data-checked", checked ? "true" : "false");
      if (window.dropmagic) {
        window.dropmagic.emit("dm:checkbox-changed", {
          value: this.getAttribute("data-value") || "",
          checked: checked,
        });
      }
      applySubscription(this, checked);
    };
  }

  customElements.define("dm-checkbox", DmCheckbox);

  // Initial sync — a subscription checkbox that starts checked seeds the
  // purchase state so its plan is on the cart line at first paint (mirrors
  // dm-selling-plan-picker.js' runInitial). Unchecked boxes leave the default
  // one-time state untouched.
  function runInitial() {
    var boxes = document.querySelectorAll(
      'dm-checkbox[data-checkbox-action="toggle-subscription"][data-checked="true"]'
    );
    for (var i = 0; i < boxes.length; i++) {
      applySubscription(boxes[i], true);
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runInitial);
  } else {
    runInitial();
  }
})();
