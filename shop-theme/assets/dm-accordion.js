/**
 * DropMagic Accordion — single source of truth for both surfaces.
 *
 * - Storefront: loaded via Liquid `<script src>` in `dm-page.liquid`.
 * - Editor canvas: `?raw`-imported in
 *   `src/components/builder/canvas/runtime-scripts.ts` and injected as
 *   inline `<script>.textContent` into the iframe doc.
 *
 * Defines two custom elements:
 *   - `<dm-accordion-item>` — hydrates initial open state from the
 *     `data-accordion-item-open="true"` attribute set by the
 *     transpiler/renderer at the schema-default level.
 *   - `<dm-accordion-trigger>` — click handler that toggles the
 *     containing item's `.dm-accordion-item--open` class. Honors the
 *     parent accordion's `data-accordion-multiple` attribute (single-
 *     open by default — clicking closes every other open item first;
 *     `"true"` lets multiple stay open).
 *
 * `<dm-accordion>` itself is intentionally NOT defined as a class — it
 * holds no behavior, only the `data-accordion-multiple` attribute that
 * the trigger reads at click time. Leaving it as an undefined custom
 * element is fine (browsers treat it as `HTMLUnknownElement`, all
 * styling + DOM querying works regardless).
 *
 * Plain ES2017, no transpilation. IIFE-wrapped. Idempotent (re-running
 * is a no-op).
 */
(function () {
  if (window.__dmAccordionInit) return;
  window.__dmAccordionInit = true;

  class DmAccordionItem extends HTMLElement {
    connectedCallback() {
      if (this.getAttribute('data-accordion-item-open') === 'true') {
        this.classList.add('dm-accordion-item--open');
      }
    }
  }

  class DmAccordionTrigger extends HTMLElement {
    connectedCallback() {
      this.addEventListener('click', this._onClick);
    }
    disconnectedCallback() {
      this.removeEventListener('click', this._onClick);
    }
    _onClick = () => {
      const item = this.closest('dm-accordion-item');
      if (!item) return;
      const accordion = item.closest('dm-accordion');
      const isOpen = item.classList.contains('dm-accordion-item--open');
      // Single-open mode (default): close every other open item before
      // toggling the clicked one. `data-accordion-multiple="true"` opts
      // into multi-open.
      if (
        accordion &&
        accordion.getAttribute('data-accordion-multiple') !== 'true' &&
        !isOpen
      ) {
        accordion
          .querySelectorAll('dm-accordion-item.dm-accordion-item--open')
          .forEach((sibling) => {
            if (sibling !== item) {
              sibling.classList.remove('dm-accordion-item--open');
            }
          });
      }
      item.classList.toggle('dm-accordion-item--open');
    };
  }

  customElements.define('dm-accordion-item', DmAccordionItem);
  customElements.define('dm-accordion-trigger', DmAccordionTrigger);
})();
