/**
 * DropMagic Option Dropdown — `<dm-dropdown>` custom element.
 * Single source of truth for both surfaces (storefront `<script src>` +
 * editor `?raw` import — see `src/components/builder/AGENTS.md` "Atom
 * interactivity").
 *
 * Responsibilities (emit-only — per the centralized-reception rule):
 *   - Per-instance click handler (added in `connectedCallback`):
 *       - Trigger click: toggle this dropdown's `data-dropdown-menu`
 *         `data-state` open/closed. Close any other open OptionDropdown
 *         menus on the page first (single-menu-open model).
 *       - Item click: flip `data-active="true"` on the clicked item +
 *         false on siblings within THIS dropdown. Emit
 *         `dm:option-selected` with `{productId, optionName, value}`.
 *         Close the menu.
 *   - Document-level concerns (module-scoped):
 *       - Outside click → close all open menus.
 *       - ESC → close all open menus.
 *
 * Reactions (price update, carousel slide, trigger label sync, per-card
 * recompute) live in `dm-dropmagic.js`'s `syncVariants`. This file only
 * EMITS — it never mutates other product-scoped DOM directly.
 */
(function () {
  if (window.__dmDropdownInit) return;
  window.__dmDropdownInit = true;

  function closeAllMenus() {
    document
      .querySelectorAll(
        "dm-dropdown [data-dropdown-menu][data-state='open']",
      )
      .forEach(function (menu) {
        menu.setAttribute("data-state", "closed");
        var trigger =
          menu.parentElement &&
          menu.parentElement.querySelector("[data-dropdown-trigger]");
        if (trigger) trigger.setAttribute("data-state", "closed");
      });
  }

  class DmDropdown extends HTMLElement {
    connectedCallback() {
      this.addEventListener("click", this._onClick);
    }
    disconnectedCallback() {
      this.removeEventListener("click", this._onClick);
    }
    _onClick = (e) => {
      var target = e.target;
      if (!target || !target.closest) return;

      // Item click — flip data-active inside THIS dropdown, emit, close.
      var item = target.closest("[data-dropdown-item]");
      if (item && item.closest("dm-dropdown") === this) {
        // Selling-plan dropdown (source=selling_plan): items carry a plan id,
        // no option-name/value. Picking a frequency sets the plan AND
        // activates the containing subscribe card (vs the one-time card).
        var spId = item.getAttribute("data-selling-plan-id");
        if (spId != null) {
          var sibsSP = this.querySelectorAll("[data-dropdown-item]");
          for (var sp = 0; sp < sibsSP.length; sp++) {
            var mSP = sibsSP[sp] === item;
            sibsSP[sp].setAttribute("data-active", mSP ? "true" : "false");
            sibsSP[sp].setAttribute("aria-selected", mSP ? "true" : "false");
          }
          var labelSP = this.querySelector("[data-dropdown-trigger-label]");
          var contentSP = item.querySelector("[data-dropdown-item-content]");
          if (labelSP && contentSP) labelSP.innerHTML = contentSP.innerHTML;
          // Activate the parent subscribe card within the picker.
          var spCard = this.closest("[data-option-picker-item]");
          var spPicker = this.closest("dm-selling-plan-picker");
          var spProductId =
            (spCard && spCard.getAttribute("data-dm-product-id")) ||
            (spPicker && spPicker.getAttribute("data-dm-product-id"));
          if (spPicker && spCard) {
            spPicker
              .querySelectorAll("[data-option-picker-item]")
              .forEach(function (c) {
                c.setAttribute("data-active", c === spCard ? "true" : "false");
              });
            // Reflect the chosen frequency on the card so its bound price
            // (selling_plan.price/compare/savings) re-renders for THIS plan —
            // syncVariants prices each card by its data-selling-plan-id.
            spCard.setAttribute("data-selling-plan-id", spId);
          }
          if (window.dropmagic && spProductId) {
            window.dropmagic.setSellingPlan(spProductId, Number(spId));
          }
          closeAllMenus();
          return;
        }

        var productId = item.getAttribute("data-dm-product-id");
        var optionName = item.getAttribute("data-variant-option-name");
        var value = item.getAttribute("data-variant-value");
        if (productId && optionName && value != null) {
          var siblings = this.querySelectorAll("[data-dropdown-item]");
          for (var i = 0; i < siblings.length; i++) {
            var match = siblings[i] === item;
            siblings[i].setAttribute("data-active", match ? "true" : "false");
            siblings[i].setAttribute(
              "aria-selected",
              match ? "true" : "false",
            );
          }
          if (window.dropmagic) {
            window.dropmagic.emit("dm:option-selected", {
              productId: productId,
              optionName: optionName,
              value: value,
            });
          }
        }
        closeAllMenus();
        return;
      }

      // Trigger click — toggle menu (closing any other open menu first).
      var trigger = target.closest("[data-dropdown-trigger]");
      if (trigger && trigger.closest("dm-dropdown") === this) {
        var menu = this.querySelector("[data-dropdown-menu]");
        if (!menu) return;
        var isOpen = menu.getAttribute("data-state") === "open";
        closeAllMenus();
        if (!isOpen) {
          menu.setAttribute("data-state", "open");
          trigger.setAttribute("data-state", "open");
        }
      }
    };
  }

  customElements.define("dm-dropdown", DmDropdown);

  // Document-level: any click that's NOT inside a dropdown closes all
  // open menus. ESC same behavior. Listeners stay module-scoped because
  // the concern is page-global, not per-instance.
  document.addEventListener("click", function (e) {
    var target = e.target;
    if (!target || !target.closest) {
      closeAllMenus();
      return;
    }
    // Click was inside a dropdown — the element's own handler decides
    // what to do. We only close here when the click hits anything else.
    if (!target.closest("dm-dropdown")) {
      closeAllMenus();
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeAllMenus();
  });
})();
