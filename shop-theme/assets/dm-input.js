/**
 * dm-input.js — the Input atom's runtime.
 *
 * Emit, don't react: this file only reports that a field changed. Everything
 * that CONSUMES the value — merging it into the /cart/add.js `properties`,
 * writing the cart note/attribute, submitting a newsletter form — lives in
 * dm-dropmagic.js, the one place cross-atom reception belongs.
 *
 * Note there is no per-keystroke state kept here or in the hub for the
 * line-property case: the hub reads the fields straight out of the DOM at
 * add-to-cart time (the same way it already resolves bundle unit variants).
 * That makes the "type fast, hit ATC immediately" race structurally impossible
 * — a debounce can't drop a value that was never buffered.
 */
(function () {
  if (window.__dmInputInit) return;
  window.__dmInputInit = true;

  // Long enough that a normal typist writes a whole word between cart writes,
  // short enough that clicking away feels instant. Only the cart-level actions
  // (note / attribute) debounce — they hit the network on every change.
  var DEBOUNCE_MS = 500;

  customElements.define(
    "dm-input",
    class extends HTMLElement {
      connectedCallback() {
        this.control = this.querySelector("input, textarea");
        if (!this.control) return;
        this.onInput = this.onInput.bind(this);
        this.control.addEventListener("input", this.onInput);
        this.control.addEventListener("change", this.onInput);
      }

      disconnectedCallback() {
        if (this.control) {
          this.control.removeEventListener("input", this.onInput);
          this.control.removeEventListener("change", this.onInput);
        }
        if (this.timer) clearTimeout(this.timer);
      }

      onInput() {
        // Typing into a field the merchant marked required clears the failed
        // add-to-cart state — the shopper is fixing it.
        this.removeAttribute("data-invalid");

        var self = this;
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(function () {
          self.emitChange();
        }, DEBOUNCE_MS);
      }

      emitChange() {
        if (!window.dropmagic) return;
        window.dropmagic.emit("dm:input-changed", {
          productId: this.getAttribute("data-dm-product-id"),
          action: this.getAttribute("data-input-action") || "none",
          name: this.getAttribute("data-input-name") || "",
          value: this.control.value,
        });
      }
    }
  );
})();
