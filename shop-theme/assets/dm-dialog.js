/**
 * DropMagic Dialog — single source of truth for both surfaces.
 *
 * - Storefront: loaded via Liquid `<script src>` in `dm-page.liquid`.
 * - Editor canvas: `?raw`-imported in
 *   `src/components/builder/canvas/runtime-scripts.ts` and injected as
 *   inline `<script>` text into the iframe doc.
 *
 * Defines three custom elements:
 *   - `<dm-dialog-trigger>` — click opens the containing `<dm-dialog>`.
 *   - `<dm-dialog>` — the inline host (`display: contents`). Pairs the
 *     trigger to the overlay and, on the storefront, lifts the overlay to
 *     `<body>` on first open.
 *   - `<dm-dialog-overlay>` — the fixed full-viewport backdrop + panel.
 *     Owns open state via its own `data-state="open" | "closed"` and its
 *     own close behavior (backdrop click, `[data-dm-dialog-close]`, Escape).
 *
 * Why the overlay lives at `<body>`: a `position: fixed` element is trapped
 * inside any ancestor with a `transform` / `filter` / `overflow` clip (a
 * Swiper carousel track, a sticky/overflow section). Portaling the overlay
 * out of `<dm-dialog>` to the document body frees it to cover the viewport.
 * Two mechanisms, one contract: the EDITOR portals via React
 * (`dialog/render.tsx`); the STOREFRONT relocates here on first open. The
 * `data-dm-edit` flag on <html> tells them apart so we never double-move.
 */
(function () {
  if (window.__dmDialogInit) return;
  window.__dmDialogInit = true;

  var isEdit = function () {
    return document.documentElement.hasAttribute("data-dm-edit");
  };
  var escapeId = function (id) {
    return window.CSS && CSS.escape ? CSS.escape(id) : id;
  };

  class DmDialogOverlay extends HTMLElement {
    static get observedAttributes() {
      return ["data-state"];
    }

    constructor() {
      super();
      // Bound once so add/removeEventListener pair up. Constructor may run
      // before connection, so keep it side-effect-free beyond this.
      this.__onKeydown = (e) => {
        if (e.key === "Escape") this.close();
      };
    }

    connectedCallback() {
      if (this.__dmBound) return;
      this.__dmBound = true;
      // Self-scoped close handling — the overlay owns its own chrome now
      // that it's detached from <dm-dialog>.
      this.addEventListener("click", (e) => {
        const t = e.target;
        if (!(t instanceof Element)) return;
        if (t.closest("[data-dm-dialog-close]")) {
          this.close();
          return;
        }
        // Backdrop = a click on the overlay padding itself, not a descendant
        // (the panel / content / close button).
        if (t === this) this.close();
      });
    }

    attributeChangedCallback(name, _oldValue, value) {
      if (name !== "data-state") return;
      // Bind the Escape listener only while open — no idle global listener.
      if (value === "open") {
        document.addEventListener("keydown", this.__onKeydown);
      } else {
        document.removeEventListener("keydown", this.__onKeydown);
        // A closed dialog only HIDES its panel — any <video>/<audio> inside
        // stays mounted and would keep playing (with sound). Pause on close.
        // This is the single choke-point for every close path (backdrop, ✕,
        // Escape, programmatic) on both surfaces. Left paused, not rewound,
        // so reopening resumes where the viewer left off.
        this.querySelectorAll("video, audio").forEach(function (m) {
          m.pause();
        });
      }
    }

    disconnectedCallback() {
      document.removeEventListener("keydown", this.__onKeydown);
    }

    close() {
      this.setAttribute("data-state", "closed");
    }
  }

  class DmDialog extends HTMLElement {
    disconnectedCallback() {
      // Storefront: drop the overlay we lifted to <body> so it doesn't leak
      // when the dialog is removed (navigation / HMR). In the editor React
      // owns the portal, and __overlay stays unset, so this is a no-op.
      if (this.__overlay && this.__overlay.parentNode === document.body) {
        document.body.removeChild(this.__overlay);
      }
    }

    resolveOverlay() {
      if (this.__overlay && this.__overlay.isConnected) return this.__overlay;
      // Storefront: authored as our direct child.
      let overlay = this.querySelector(":scope > dm-dialog-overlay");
      // Editor: React portaled it to <body>; pair by id.
      if (!overlay) {
        const id = this.getAttribute("data-dialog-id");
        if (id) {
          overlay = document.querySelector(
            'dm-dialog-overlay[data-dialog-for="' + escapeId(id) + '"]'
          );
        }
      }
      this.__overlay = overlay;
      return overlay;
    }

    open() {
      const overlay = this.resolveOverlay();
      if (!overlay) return;
      // Storefront only: lift the overlay to <body> on first open so its
      // position:fixed escapes any transformed / overflow ancestor. Done at
      // click time, so server-rendered children are guaranteed parsed. The
      // editor already portaled it (skip — a double move fights React).
      if (!isEdit() && overlay.parentNode !== document.body) {
        document.body.appendChild(overlay);
      }
      // Now at <body>, the overlay sits OUTSIDE the themed combination scope
      // that supplies the brand tokens (--dm-background, --dm-foreground,
      // --dm-primary, …). Mirror the dialog's own combination so the box matches
      // the same token rule and recovers the full set — else the `informative`
      // box paints transparent + black (invisible). This rides the PANEL, NOT
      // the overlay: `[data-theme-combination]` / `[n]` also carry
      // `position: relative` (section context) whose specificity beats the
      // overlay's `position: fixed` and would drop it into flow. The panel is
      // already `position: relative`. The storefront keys the scope on `n`
      // (`[n='X']`); the admin block editor on `data-theme-combination`. Copy
      // whichever the nearest ancestor carries; re-read each open so switching
      // combinations stays live.
      var panel = overlay.querySelector(".dm-dialog__panel");
      if (panel) {
        var nScope = this.closest("[n]");
        if (nScope) panel.setAttribute("n", nScope.getAttribute("n"));
        var comboScope = this.closest("[data-theme-combination]");
        if (comboScope) {
          panel.setAttribute(
            "data-theme-combination",
            comboScope.getAttribute("data-theme-combination")
          );
        }
      }
      overlay.setAttribute("data-state", "open");
    }

    close() {
      const overlay = this.resolveOverlay();
      if (overlay) overlay.setAttribute("data-state", "closed");
    }
  }

  class DmDialogTrigger extends HTMLElement {
    connectedCallback() {
      if (this.__dmBound) return;
      this.__dmBound = true;
      this.addEventListener("click", () => {
        // Editor: a click on the trigger SELECTS the dialog. Opening the
        // full-viewport overlay here covered the canvas and sent every next
        // click into the pop-up, so the dialog itself could never be moved or
        // deleted. The Dialog toolbar's "Open pop-up" button opens it instead.
        if (isEdit()) return;
        const dialog = this.closest("dm-dialog");
        if (dialog && typeof dialog.open === "function") dialog.open();
      });
    }
  }

  if (!customElements.get("dm-dialog-overlay")) {
    customElements.define("dm-dialog-overlay", DmDialogOverlay);
  }
  if (!customElements.get("dm-dialog")) {
    customElements.define("dm-dialog", DmDialog);
  }
  if (!customElements.get("dm-dialog-trigger")) {
    customElements.define("dm-dialog-trigger", DmDialogTrigger);
  }
})();
