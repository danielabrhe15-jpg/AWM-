/**
 * DropMagic Sheet — single source of truth for both surfaces.
 *
 * - Storefront: loaded via Liquid `<script src>` in `dm-page.liquid`.
 * - Editor canvas: `?raw`-imported in
 *   `src/components/builder/canvas/runtime-scripts.ts` and injected as
 *   inline `<script>` text into the iframe doc.
 *
 * Side-drawer sibling of `dm-dialog.js`. Defines two custom elements:
 *   - `<dm-sheet-trigger>` — click opens the containing `<dm-sheet>`.
 *   - `<dm-sheet>` — owns open state via `data-state="open" | "closed"`.
 *     While connected, a self-scoped click handler closes on a backdrop
 *     (`.dm-sheet__overlay`) or close-button (`[data-dm-sheet-close]`) hit;
 *     while open, a document `keydown` handler closes on Escape (bound on
 *     open, unbound on close — no idle global listener).
 *
 * `<dm-sheet-content>` owns no behavior, so it stays undefined — show / hide
 * + slide animation are pure CSS off the root's `data-state` + `data-sheet-side`
 * in dm-theme.css.
 */
(function () {
  if (window.__dmSheetInit) return;
  window.__dmSheetInit = true;

  class DmSheet extends HTMLElement {
    connectedCallback() {
      if (this.__dmBound) return;
      this.__dmBound = true;
      if (!this.hasAttribute("data-state")) {
        this.setAttribute("data-state", "closed");
      }
      this.__onKeydown = (e) => {
        if (e.key === "Escape") this.close();
      };
      // Delegated within this sheet's own subtree — close button and backdrop
      // both live under `<dm-sheet>`.
      this.addEventListener("click", (e) => {
        const t = e.target;
        if (!(t instanceof Element)) return;
        if (t.closest("[data-dm-sheet-close]")) {
          this.close();
          return;
        }
        // Backdrop = a click landing ON `.dm-sheet__overlay` itself, not on a
        // descendant (the panel / content / close button).
        if (t.classList.contains("dm-sheet__overlay")) this.close();
      });
    }

    disconnectedCallback() {
      document.removeEventListener("keydown", this.__onKeydown);
    }

    // A cart drawer (`data-sheet-open-on="cart"`) is pinned open inside the
    // builder canvas so it can be designed — the iframe marks edit mode with
    // `data-dm-edit` on <html> (same flag the `[data-hide]` rules gate on).
    // No trigger exists to reopen it, so backdrop / close-button / Escape are
    // all no-ops there. On the storefront `data-dm-edit` is absent, so the
    // drawer closes normally (dm-cart.js owns its open/close).
    __editPinned() {
      return (
        this.getAttribute("data-sheet-open-on") === "cart" &&
        document.documentElement.hasAttribute("data-dm-edit")
      );
    }

    open() {
      this.setAttribute("data-state", "open");
      document.addEventListener("keydown", this.__onKeydown);
    }

    close() {
      if (this.__editPinned()) return;
      this.setAttribute("data-state", "closed");
      document.removeEventListener("keydown", this.__onKeydown);
    }
  }

  class DmSheetTrigger extends HTMLElement {
    connectedCallback() {
      if (this.__dmBound) return;
      this.__dmBound = true;
      this.addEventListener("click", (e) => {
        // The trigger's child is a Button, which publishes as a plain `<a>`
        // carrying the atom's `href` — `#` on every catalog header (there is
        // no "no destination" value in the link model). Opening the sheet is
        // the whole point of the trigger, so the anchor must never also
        // navigate: a bare `#` scrolls the document to the top and pushes a
        // history entry, so tapping the burger jumped the page and armed a
        // Back that appears to do nothing. Suppress before opening.
        if (e.target instanceof Element && e.target.closest("a")) {
          e.preventDefault();
        }
        const sheet = this.closest("dm-sheet");
        if (sheet && typeof sheet.open === "function") sheet.open();
      });
    }
  }

  if (!customElements.get("dm-sheet")) {
    customElements.define("dm-sheet", DmSheet);
  }
  if (!customElements.get("dm-sheet-trigger")) {
    customElements.define("dm-sheet-trigger", DmSheetTrigger);
  }
})();
