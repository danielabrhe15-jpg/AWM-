/**
 * dm-before-after.js — `<dm-before-after>` custom element. Single source
 * of truth for both surfaces (storefront `<script src>` + editor `?raw`
 * import — see `src/components/builder/AGENTS.md` "Atom interactivity").
 *
 * The slider position is a single CSS var (`--dm-before-after-position`,
 * 0–100). CSS does the clip + line + handle positioning. JS only writes
 * the var on drag / click / arrow keys.
 */
(function () {
  if (window.__dmBeforeAfterInit) return;
  window.__dmBeforeAfterInit = true;

  class DmBeforeAfter extends HTMLElement {
    connectedCallback() {
      if (this.dataset.dmInit) return;
      this.dataset.dmInit = "1";

      var el = this;
      var handle = el.querySelector("[data-ba-handle]");
      var frame = el.querySelector("[data-ba-frame]");
      if (!handle || !frame) return;

      this._dmHandle = handle;
      this._dmFrame = frame;

      var dragging = false;

      function writePct(pct) {
        var clamped = Math.max(0, Math.min(100, pct));
        el.style.setProperty("--dm-before-after-position", String(clamped));
      }

      function pctFromClientX(clientX) {
        var rect = frame.getBoundingClientRect();
        if (rect.width === 0) return 50;
        return ((clientX - rect.left) / rect.width) * 100;
      }

      this._dmOnPointerDown = function (e) {
        dragging = true;
        handle.setPointerCapture(e.pointerId);
        writePct(pctFromClientX(e.clientX));
      };
      this._dmOnPointerMove = function (e) {
        if (!dragging) return;
        writePct(pctFromClientX(e.clientX));
      };
      this._dmOnPointerRelease = function (e) {
        dragging = false;
        if (handle.hasPointerCapture(e.pointerId)) {
          handle.releasePointerCapture(e.pointerId);
        }
      };
      this._dmOnFrameClick = function (e) {
        if (e.target === handle) return;
        if (handle.contains(e.target)) return;
        writePct(pctFromClientX(e.clientX));
      };
      this._dmOnKeyDown = function (e) {
        var current =
          parseFloat(
            getComputedStyle(el).getPropertyValue("--dm-before-after-position"),
          ) || 50;
        var next = current;
        if (e.key === "ArrowLeft") next = current - 5;
        else if (e.key === "ArrowRight") next = current + 5;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = 100;
        else return;
        e.preventDefault();
        writePct(next);
      };

      handle.addEventListener("pointerdown", this._dmOnPointerDown);
      handle.addEventListener("pointermove", this._dmOnPointerMove);
      handle.addEventListener("pointerup", this._dmOnPointerRelease);
      handle.addEventListener("pointercancel", this._dmOnPointerRelease);
      handle.addEventListener("keydown", this._dmOnKeyDown);
      frame.addEventListener("click", this._dmOnFrameClick);
    }

    disconnectedCallback() {
      var handle = this._dmHandle;
      var frame = this._dmFrame;
      if (handle) {
        handle.removeEventListener("pointerdown", this._dmOnPointerDown);
        handle.removeEventListener("pointermove", this._dmOnPointerMove);
        handle.removeEventListener("pointerup", this._dmOnPointerRelease);
        handle.removeEventListener("pointercancel", this._dmOnPointerRelease);
        handle.removeEventListener("keydown", this._dmOnKeyDown);
      }
      if (frame) {
        frame.removeEventListener("click", this._dmOnFrameClick);
      }
    }
  }

  customElements.define("dm-before-after", DmBeforeAfter);
})();
