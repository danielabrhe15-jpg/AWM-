/**
 * DropMagic Bundle Units — `<dm-bundle-units>` custom element. Selection-only
 * (emit-only, per the centralized-reception rule): a per-unit picker change
 * bubbles to this element, which announces `dm:bundle-unit-changed`. ALL
 * reception — resolving each unit's variant, repricing the bar, and building the
 * per-unit cart lines — lives in dm-dropmagic.js.
 *
 * Published DOM (see dm-bundle-units.liquid): one row per tier unit, each a
 *   <div data-bundle-unit data-unit-index data-bar-id data-unit-role>
 *     <img data-bundle-unit-thumb> + one picker per REAL product option.
 *
 * Every picker mode carries a NATIVE <select data-dm-bundle-unit="barId:idx"
 * data-option-index> — THE runtime contract (dm-dropmagic resolves variants
 * off these selects only):
 *  - dropdown            → the bare select.
 *  - color-dropdown /
 *    image-dropdown      → [data-unit-opt] wrapper: pre-rendered per-value
 *                          indicators (color dot / variant thumb) + the select;
 *                          this element toggles `data-selected` on change.
 *  - text-button / color-swatch / image-swatch
 *                        → [data-unit-opt] wrapper: a HIDDEN proxy select
 *                          ([data-unit-proxy]) + per-value <button
 *                          data-unit-value>; a click sets the proxy's value and
 *                          dispatches `change`, so the shared path runs.
 *
 * The element only listens + emits; gated off in edit (`data-dm-edit`), where
 * React renders the pickers and nothing adds to cart.
 *
 * Plain ES2017, IIFE-wrapped, idempotent.
 */
(function () {
  if (window.__dmBundleUnitsInit) return;
  window.__dmBundleUnitsInit = true;

  function isEdit() {
    return document.documentElement.hasAttribute("data-dm-edit");
  }

  class DmBundleUnits extends HTMLElement {
    connectedCallback() {
      this.addEventListener("change", this._onChange);
      this.addEventListener("click", this._onClick);
    }
    disconnectedCallback() {
      this.removeEventListener("change", this._onChange);
      this.removeEventListener("click", this._onClick);
    }
    // A value button (text-button / color-swatch / image-swatch) → write the
    // proxy select and fire `change`, so every mode flows through _onChange.
    _onClick = (e) => {
      if (isEdit()) return;
      var btn = e.target && e.target.closest ? e.target.closest("button[data-unit-value]") : null;
      if (!btn || !this.contains(btn)) return;
      var wrap = btn.closest("[data-unit-opt]");
      if (!wrap) return;
      var sel = wrap.querySelector("select[data-dm-bundle-unit]");
      if (!sel) return;
      var value = btn.getAttribute("data-unit-value") || "";
      if (sel.value !== value) {
        sel.value = value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    };
    _onChange = (e) => {
      if (isEdit()) return;
      var sel = e.target;
      if (!sel || sel.tagName !== "SELECT") return;
      // Sync the wrapper's per-value marks (button `data-selected` state,
      // dropdown indicators) to the select's value — own-UI upkeep, not
      // cross-atom reception.
      var wrap = sel.closest("[data-unit-opt]");
      if (wrap) {
        var marks = wrap.querySelectorAll("[data-unit-value]");
        for (var i = 0; i < marks.length; i++) {
          if ((marks[i].getAttribute("data-unit-value") || "") === sel.value) {
            marks[i].setAttribute("data-selected", "");
          } else {
            marks[i].removeAttribute("data-selected");
          }
        }
      }
      var scope = sel.getAttribute("data-dm-bundle-unit") || "";
      var parts = scope.split(":");
      if (!window.dropmagic) return;
      window.dropmagic.emit("dm:bundle-unit-changed", {
        productId: sel.getAttribute("data-dm-product-id") || null,
        barId: parts[0] || null,
        unitIndex: parts[1] || null,
      });
    };
  }

  customElements.define("dm-bundle-units", DmBundleUnits);
})();
