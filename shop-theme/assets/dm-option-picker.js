/**
 * DropMagic Option Picker — `<dm-option-picker>` custom element. Single
 * source of truth for both surfaces (storefront `<script src>` + editor
 * `?raw` import — see `src/components/builder/AGENTS.md` "Atom
 * interactivity").
 *
 * Responsibilities (emit-only — per the centralized-reception rule):
 *   - Per-instance click handler (added in `connectedCallback`): on a
 *     `[data-option-picker-item]` click inside this picker, flip the
 *     card's `data-active="true"` (and `false` on siblings), gather
 *     active values across every OptionPicker scoped to the same
 *     product, resolve a variant, and emit:
 *        - `dm:option-selected` on every click (with productId,
 *          optionName, value)
 *        - `dm:variant-resolved` when a full option-tuple matches a
 *          variant
 *   - DOMContentLoaded initial-emit (document-level, module-scoped):
 *     for each scoped product, mark the option values matching the URL
 *     `?variant=`/first-available variant as `data-active="true"`,
 *     then emit one `dm:variant-resolved` carrying `initial: true` and
 *     `requested` (whether `?variant=` named that variant), so the
 *     centralized listener in `dm-dropmagic.js` can tell a shopper's
 *     deep link apart from our own default pick.
 *
 * Zero `dm.on(...)` calls — reactions live in `dm-dropmagic.js`.
 */
(function () {
  if (window.__dmOptionPickerInit) return;
  window.__dmOptionPickerInit = true;

  // Cache parsed product JSONs by `productId`. Re-parsing on every click
  // is cheap (<1ms for typical products) but caching keeps the click
  // path tight for sub-millisecond response on rapid swatch clicks.
  var productCache = Object.create(null);

  function readProduct(productId) {
    if (productCache[productId]) return productCache[productId];
    var script = document.querySelector(
      'script[type="application/json"][data-dm-product-id="' + productId + '"]',
    );
    if (!script) return null;
    try {
      var parsed = JSON.parse(script.textContent || "{}");
      productCache[productId] = parsed;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  // Returns `{ variant, requested }`. `requested` is true only when the URL
  // `?variant=` named this variant — i.e. the shopper asked for it. The
  // first-available / first fallbacks are OUR pick, not theirs, and the
  // carousel sync treats the two differently on first paint.
  function initialVariant(product) {
    if (!product || !product.variants || !product.variants.length) {
      return { variant: null, requested: false };
    }
    var urlVariantId = null;
    try {
      urlVariantId = new URLSearchParams(window.location.search).get("variant");
    } catch (_) {}
    var requestedVariant =
      (urlVariantId &&
        product.variants.find(function (v) {
          return String(v.id) === urlVariantId;
        })) ||
      null;
    if (requestedVariant) return { variant: requestedVariant, requested: true };
    return {
      variant:
        product.variants.find(function (v) {
          return v.available;
        }) ||
        product.variants[0] ||
        null,
      requested: false,
    };
  }

  // Gather active values across all OptionPickers scoped to a productId.
  // Returns { optionName: value, ... } — partial when not every option
  // has a selection. Caller decides whether that's enough to resolve a
  // variant.
  function gatherActiveOptions(productId) {
    var pickers = document.querySelectorAll(
      'dm-option-picker[data-dm-product-id="' + productId + '"]',
    );
    var out = {};
    for (var i = 0; i < pickers.length; i++) {
      var picker = pickers[i];
      var optionName = picker.getAttribute("data-option-name");
      if (!optionName) continue;
      var active = picker.querySelector(
        '[data-option-picker-item][data-active="true"]',
      );
      if (!active) continue;
      var value = active.getAttribute("data-variant-value");
      if (value != null) out[optionName] = value;
    }
    return out;
  }

  // Match all selected options against the product's variants. Each option
  // is matched against `variant.option1` / `option2` / `option3` by the
  // option's position in `product.options[]`. Returns the first full match
  // or null when partial / no match.
  function resolveVariant(product, activeOptions) {
    if (!product || !product.options || !product.variants) return null;
    var options = product.options;
    if (options.length === 0) return null;
    for (var i = 0; i < options.length; i++) {
      if (activeOptions[options[i].name] == null) return null;
    }
    return (
      product.variants.find(function (v) {
        for (var i = 0; i < options.length; i++) {
          if (v["option" + (i + 1)] !== activeOptions[options[i].name]) {
            return false;
          }
        }
        return true;
      }) || null
    );
  }

  function emitVariantResolved(productId, variant, activeOptions, flags) {
    if (!window.dropmagic) return;
    window.dropmagic.emit("dm:variant-resolved", {
      productId: productId,
      variantId: variant.id,
      mediaId:
        variant.featured_media_id != null ? variant.featured_media_id : null,
      priceCents: variant.price,
      available: variant.available,
      options: activeOptions,
      // First paint vs. a shopper's click, and — on first paint — whether
      // `?variant=` asked for this variant. Absent on click emits, which
      // read as `false`.
      initial: !!(flags && flags.initial),
      requested: !!(flags && flags.requested),
    });
  }

  class DmOptionPicker extends HTMLElement {
    connectedCallback() {
      this.addEventListener("click", this._onClick);
    }
    disconnectedCallback() {
      this.removeEventListener("click", this._onClick);
    }
    _onClick = (e) => {
      var target = e.target;
      if (!target || !target.closest) return;
      var card = target.closest("[data-option-picker-item]");
      if (!card) return;
      // Defensive: ignore card clicks that bubble from a NESTED picker
      // (rare but possible with composition atoms).
      if (card.closest("dm-option-picker") !== this) return;

      var productId = card.getAttribute("data-dm-product-id");
      var optionName = card.getAttribute("data-variant-option-name");
      var value = card.getAttribute("data-variant-value");
      if (!productId || !optionName || value == null) return;

      // Flip data-active on siblings within this picker.
      var siblings = this.querySelectorAll("[data-option-picker-item]");
      for (var i = 0; i < siblings.length; i++) {
        siblings[i].setAttribute(
          "data-active",
          siblings[i] === card ? "true" : "false",
        );
      }

      if (window.dropmagic) {
        window.dropmagic.emit("dm:option-selected", {
          productId: productId,
          optionName: optionName,
          value: value,
        });
      }

      var product = readProduct(productId);
      if (!product) return;
      var active = gatherActiveOptions(productId);
      var variant = resolveVariant(product, active);
      if (variant) emitVariantResolved(productId, variant, active);
    };
  }

  customElements.define("dm-option-picker", DmOptionPicker);

  // Initial sync on DOMContentLoaded — one pass per registered product.
  // For each product, pick the initial variant (URL `?variant=` > first
  // available > first), mark its option values as active across all
  // OptionPickers scoped to that product, then emit `dm:variant-resolved`
  // so every variant-derived value (prices, add-to-cart state, bindings)
  // reflects it. The emit carries `initial` + `requested` — a bound
  // carousel only slides off its first slide when the shopper asked for a
  // variant, never for our own default pick.
  //
  // Page-scoped (not per-instance) because resolving a variant requires
  // every option to have a value — a freshly-connected single picker
  // would only know about its own option. The DOMContentLoaded pass is
  // the natural fence where every picker is mounted.
  function runInitial() {
    var scripts = document.querySelectorAll(
      'script[type="application/json"][data-dm-product-id]',
    );
    for (var i = 0; i < scripts.length; i++) {
      var productId = scripts[i].getAttribute("data-dm-product-id");
      if (!productId) continue;
      var product = readProduct(productId);
      if (!product) continue;
      var initial = initialVariant(product);
      var variant = initial.variant;
      if (!variant || !product.options) continue;

      var activeOptions = {};
      for (var k = 0; k < product.options.length; k++) {
        var opt = product.options[k];
        var optionName = opt.name;
        var optionValue = variant["option" + (k + 1)];
        if (optionValue == null) continue;
        activeOptions[optionName] = optionValue;

        var pickers = document.querySelectorAll(
          'dm-option-picker[data-dm-product-id="' +
            productId +
            '"][data-option-name="' +
            optionName +
            '"]',
        );
        for (var p = 0; p < pickers.length; p++) {
          var cards = pickers[p].querySelectorAll("[data-option-picker-item]");
          for (var c = 0; c < cards.length; c++) {
            cards[c].setAttribute(
              "data-active",
              cards[c].getAttribute("data-variant-value") === optionValue
                ? "true"
                : "false",
            );
          }
        }
      }

      emitVariantResolved(productId, variant, activeOptions, {
        initial: true,
        requested: initial.requested,
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runInitial);
  } else {
    runInitial();
  }
})();
