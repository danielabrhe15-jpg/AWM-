/**
 * DropMagic Tabs — single source of truth for both surfaces.
 *
 * - Storefront: loaded via Liquid `<script src>` in `dm-page.liquid`.
 * - Editor canvas: `?raw`-imported in
 *   `src/components/builder/canvas/runtime-scripts.ts` and injected as
 *   inline `<script>.textContent` into the iframe doc.
 *
 * Defines two custom elements:
 *   - `<dm-tabs>` — on connect, activates the initial tab (explicit
 *     `data-tabs-default-value` if present, otherwise the first
 *     `<dm-tabs-trigger>`). Skips already-active tabs so user clicks
 *     aren't clobbered when the element re-attaches.
 *   - `<dm-tabs-trigger>` — click handler that activates `data-tabs-value`
 *     across the nearest `<dm-tabs>` (matching triggers + panels).
 *
 * Scoped activation: `el.closest('dm-tabs') === tabs` filters out nested
 * tabs so a click in an inner tabs panel doesn't bleed into the outer.
 *
 * Plain ES2017, no transpilation. IIFE-wrapped. Idempotent.
 */
(function () {
  if (window.__dmTabsInit) return;
  window.__dmTabsInit = true;

  function activate(tabs, value) {
    if (!tabs || !value) return;
    tabs.querySelectorAll('[data-tabs-value]').forEach(function (el) {
      var tag = el.tagName.toLowerCase();
      if (tag !== 'dm-tabs-trigger' && tag !== 'dm-tabs-panel') return;
      if (el.closest('dm-tabs') !== tabs) return;
      el.classList.toggle('dm-tabs--active', el.dataset.tabsValue === value);
    });
  }

  class DmTabs extends HTMLElement {
    connectedCallback() {
      // Defer one microtask so the children (triggers + panels) have
      // been hydrated by the renderer (json-render in editor, Liquid in
      // storefront) before we read them. Without this, the first trigger
      // query can race against the parent's DOM construction.
      queueMicrotask(() => this._activateInitial());
    }
    _activateInitial() {
      // Skip if a user has already clicked something — initial activation
      // shouldn't clobber interaction state if the element re-attaches.
      if (
        this.querySelector(
          ':scope dm-tabs-trigger.dm-tabs--active, :scope dm-tabs-panel.dm-tabs--active',
        )
      ) {
        return;
      }
      var explicit = this.dataset.tabsDefaultValue;
      var value = explicit && explicit !== '' ? explicit : null;
      if (!value) {
        var firstTrigger = this.querySelector(
          'dm-tabs-trigger[data-tabs-value]',
        );
        value = firstTrigger ? firstTrigger.dataset.tabsValue : null;
      }
      activate(this, value);
    }
  }

  class DmTabsTrigger extends HTMLElement {
    connectedCallback() {
      this.addEventListener('click', this._onClick);
    }
    disconnectedCallback() {
      this.removeEventListener('click', this._onClick);
    }
    _onClick = () => {
      var tabs = this.closest('dm-tabs');
      if (!tabs) return;
      activate(tabs, this.dataset.tabsValue);
    };
  }

  customElements.define('dm-tabs', DmTabs);
  customElements.define('dm-tabs-trigger', DmTabsTrigger);
})();
