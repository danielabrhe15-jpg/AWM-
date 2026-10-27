/**
 * DropMagic global runtime — single source of truth for both surfaces.
 *
 * - Storefront: loaded as a `<script src>` via `dm-page.liquid` →
 *   `{{ 'dm-dropmagic.js' | asset_url }}`.
 * - Editor canvas: `?raw`-imported in
 *   `src/components/builder/canvas/runtime-scripts.ts` and injected as
 *   inline `<script>.textContent` into the iframe doc (React's
 *   `<script src>` doesn't reliably execute inside about:blank iframes).
 *
 * TS surface lives in `src/types/dropmagic.d.ts`.
 *
 * **Architecture** — pure event bus + centralized reception. Component
 * scripts (dm-carousel.js, dm-list.js, dm-option-picker.js, …)
 * only EMIT via `dm.emit(...)`. ALL `dm.on(...)` listeners live in this
 * file so cross-cutting reactions (variant-resolved → slide bound
 * carousels, slide-changed → sync siblings) are inspectable in one place.
 *
 * No registry. No state. Events carry full payloads; consumers act on
 * them. Components hold their own data (rendered by Liquid / TSX).
 *
 * Plain ES2017, no transpilation. IIFE-wrapped. Idempotent.
 */
(function () {
  if (window.dropmagic && window.dropmagic.__init) return;

  var dm = (window.dropmagic = window.dropmagic || {});
  dm.__init = true;
  dm.version = "1.0.0";

  // ── Simulated surface guard ──────────────────────────────────────────
  // The builder canvas marks its iframe `<html>` with exactly one of two
  // flags (iframe-canvas.tsx): `data-dm-edit` while editing, `data-dm-preview`
  // on a preview surface. Neither is present on a storefront. Both mean the
  // same thing to the network actions below — there is no Shopify session
  // here, so /cart/*.js and /contact can only 404. Behavior that is purely
  // local (smooth scroll, DOM sync) keeps gating on `data-dm-edit` alone: it
  // should still run in preview.
  function simulated() {
    var html = document.documentElement;
    return (
      html.hasAttribute("data-dm-edit") || html.hasAttribute("data-dm-preview")
    );
  }

  // ── Event bus ────────────────────────────────────────────────────────
  dm.emit = function (name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail: detail }));
  };
  dm.on = function (name, handler) {
    var wrapped = function (e) {
      handler(e.detail);
    };
    document.addEventListener(name, wrapped);
    return function () { document.removeEventListener(name, wrapped); };
  };

  // ── Setters (pure emitters; convenience for components) ──────────────
  dm.setOption = function (productId, optionName, value) {
    dm.emit("dm:option-selected", {
      productId: productId,
      optionName: optionName,
      value: value,
    });
  };
  dm.setQuantity = function (productId, quantity) {
    dm.emit("dm:quantity-changed", {
      productId: productId,
      quantity: quantity,
    });
  };
  dm.setSellingPlan = function (productId, sellingPlanId) {
    dm.emit("dm:selling-plan-changed", {
      productId: productId,
      sellingPlanId: sellingPlanId,
    });
  };

  // ── Product data lookups ─────────────────────────────────────────────
  // Pulled on demand by listeners that need richer-than-payload info
  // (per-variant price, featured_media, etc.). Source of truth is the
  // `<script type="application/json" data-dm-product-id="X">` blob emitted
  // by dm-page.liquid (trimmed shape — see `DropmagicTrimmedProduct` type).
  // Parsed once per productId per page load and cached.
  var productCache = Object.create(null);
  dm.getProduct = function (productId) {
    var key = String(productId);
    if (productCache[key]) return productCache[key];
    var script = document.querySelector(
      'script[type="application/json"][data-dm-product-id="' + key + '"]'
    );
    if (!script) return null;
    try {
      var parsed = JSON.parse(script.textContent || "{}");
      productCache[key] = parsed;
      return parsed;
    } catch (e) {
      return null;
    }
  };
  dm.getVariant = function (productId, variantId) {
    var p = dm.getProduct(productId);
    if (!p || !p.variants) return null;
    var target = Number(variantId);
    for (var i = 0; i < p.variants.length; i++) {
      if (p.variants[i].id === target) return p.variants[i];
    }
    return null;
  };

  // ── Money formatting ─────────────────────────────────────────────────────
  // `shop.money_format` is emitted once as a data element (by dm-cart-drawer.liquid
  // / dm-page.liquid). This lets client code — the cart drawer's optimistic
  // render — turn cents into the shop's localized string with NO server round
  // trip (so an optimistically-added line shows the right price immediately).
  // Standard Shopify formatMoney algorithm; HTML in the format is stripped so
  // the result is safe as textContent.
  var moneyFormat = null;
  function getMoneyFormat() {
    if (moneyFormat != null) return moneyFormat;
    var el = document.querySelector("[data-dm-money-format]");
    try {
      moneyFormat = el ? JSON.parse(el.textContent || '""') : "";
    } catch (e) {
      moneyFormat = "";
    }
    if (!moneyFormat) moneyFormat = "${{amount}}";
    moneyFormat = String(moneyFormat).replace(/<[^>]+>/g, ""); // strip span wrappers
    return moneyFormat;
  }
  dm.formatMoney = function (cents) {
    var format = getMoneyFormat();
    if (typeof cents === "string") cents = cents.replace(".", "");
    var num = Number(cents);
    if (isNaN(num)) num = 0;
    function fmt(precision, thousands, decimal) {
      var n = (num / 100.0).toFixed(precision);
      var parts = n.split(".");
      var whole = parts[0].replace(/(\d)(?=(\d\d\d)+(?!\d))/g, "$1" + thousands);
      return whole + (parts[1] ? decimal + parts[1] : "");
    }
    var m = format.match(/\{\{\s*(\w+)\s*\}\}/);
    if (!m) return format;
    var value;
    switch (m[1]) {
      case "amount": value = fmt(2, ",", "."); break;
      case "amount_no_decimals": value = fmt(0, ",", "."); break;
      case "amount_with_comma_separator": value = fmt(2, ".", ","); break;
      case "amount_no_decimals_with_comma_separator": value = fmt(0, ".", ","); break;
      case "amount_with_apostrophe_separator": value = fmt(2, "'", "."); break;
      case "amount_with_space_separator": value = fmt(2, " ", ","); break;
      case "amount_no_decimals_with_space_separator": value = fmt(0, " ", ""); break;
      default: value = fmt(2, ",", ".");
    }
    return format.replace(/\{\{\s*\w+\s*\}\}/, value);
  };

  // ── Per-product purchase state ───────────────────────────────────────
  // The cart line is { variant, quantity, selling_plan? } — every input
  // already flows through dm events, so the hub tracks the latest value
  // per product. Seeded on first paint by the pickers' runInitial
  // (dm:variant-resolved fires for every product blob on the page).
  var purchaseState = Object.create(null);
  function stateFor(productId) {
    var key = String(productId);
    if (!purchaseState[key]) {
      // `bundle` (set by the dm:bundle-selected listener) is the selected Bundle
      // tier — `{ bundleId, barId, bar }`. When present, addToCart builds the
      // tier's cart lines instead of the plain single-variant line.
      purchaseState[key] = {
        variantId: null,
        sellingPlanId: null,
        quantity: 1,
        bundle: null,
      };
    }
    return purchaseState[key];
  }
  dm.getPurchaseState = function (productId) {
    return stateFor(productId);
  };

  // ── Add to cart ──────────────────────────────────────────────────────
  // Submits the product's current purchase state to Shopify's AJAX cart.
  // Variant fallback (no picker on the page → no dm:variant-resolved):
  // first available variant from the product blob. `selling_plan` rides
  // along when a plan is active — that's the entire subscription-app
  // integration surface (checkout owns the contract).
  function resolveVariantId(productId, s) {
    if (s.variantId != null) return s.variantId;
    var product = dm.getProduct(productId);
    var variants = (product && product.variants) || [];
    for (var i = 0; i < variants.length; i++) {
      if (variants[i].available) return variants[i].id;
    }
    return variants.length ? variants[0].id : null;
  }

  // Build the cart line(s) for a selected Bundle tier. The discount Function
  // uses the `bundles`/`extraBars` config, which selects the discount by the
  // line's `_bar_id` (the tier the customer PICKED) — so mixed QB+bxgy bundles
  // and same-quantity tiers resolve correctly (a `quantityTiers` config would
  // infer the tier from total quantity and pick the wrong one).
  //   QB   → one line, qty = tier.quantity, `_bundle_type: "quantity-breaks"`.
  //   bxgy → one "get" line (qty = getQty) + one "buy" line (qty =
  //          buyQty). The `bundles` path needs the buy/get split — it
  //          discounts the GET line(s) via `applyBxgyBarDiscount`. GET first so
  //          the Function targets them. (One line per type today; per-UNIT lines
  //          only matter once each unit can be a different variant — the
  //          per-item-picker TODO.)
  // `_bar_id` drives the DISCOUNT (the Function looks the picked tier up by it);
  // the quantities here are the CART CONTENTS (a Function can only discount lines
  // already in the cart — it can't add products). buyQty/getQty come
  // from the same `bar_items` (`data-bars`), so client + Function config agree.
  // Uses the page's selected variant (per-component pickers are a later slice).
  function buildBundleItems(productId, variantId, bundle) {
    var bar = bundle.bar;
    var barId = bundle.barId;

    // Per-unit pickers (BundleUnits): one cart line per unit row, each with its
    // OWN resolved variant (the unit's selects) + role. GET lines first (the
    // Function discounts them). Falls through to the count-based lines when the
    // selected bar has no per-unit rows (a plain bar molecule).
    var unitEls = barId
      ? document.querySelectorAll(
          '[data-bundle-unit][data-bar-id="' + barId + '"]'
        )
      : [];
    if (unitEls.length) {
      var perUnit = [];
      for (var u = 0; u < unitEls.length; u++) {
        var unitEl = unitEls[u];
        var role = unitEl.getAttribute("data-unit-role") || "quantity-breaks";
        var v = resolveUnitVariant(productId, unitEl);
        perUnit.push({
          id: v ? v.id : variantId,
          role: role,
          properties: { _bundle_type: role, _bar_id: barId },
        });
      }
      // GET before buy/qb — the Function targets GET lines. Stable within role.
      perUnit.sort(function (a, b) {
        return (a.role === "get" ? 0 : 1) - (b.role === "get" ? 0 : 1);
      });
      return perUnit.map(function (x) {
        return { id: x.id, quantity: 1, properties: x.properties };
      });
    }

    // No per-unit rows — count-based lines, all the page's resolved variant.
    if (bar && bar.type === "bxgy") {
      var items = [];
      var getQty = bar.getQty || 0;
      var buyQty = bar.buyQty || 0;
      if (getQty > 0) {
        items.push({
          id: variantId,
          quantity: getQty,
          properties: { _bundle_type: "get", _bar_id: barId },
        });
      }
      if (buyQty > 0) {
        items.push({
          id: variantId,
          quantity: buyQty,
          properties: { _bundle_type: "buy", _bar_id: barId },
        });
      }
      return items;
    }
    return [
      {
        id: variantId,
        quantity: (bar && bar.quantity) || 1,
        properties: { _bundle_type: "quantity-breaks", _bar_id: barId },
      },
    ];
  }

  // ── Input atom → cart ────────────────────────────────────────────────
  // A cart-level write (note / attributes) the drawer must not react to.
  // dm-cart.js publishes the fetch it captured before patching `window.fetch`;
  // going through the patched one would refresh the drawer on every debounced
  // keystroke and eat the caret of the very field being typed into. Falls back
  // to plain fetch when the drawer script isn't on the page at all.
  function writeCart(body) {
    if (simulated()) return;
    var f = window.__dmOrigFetch || window.fetch;
    return f("/cart/update.js", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  }

  function lineInputsFor(productId) {
    return document.querySelectorAll(
      'dm-input[data-input-action="line-property"][data-dm-product-id="' +
        String(productId) +
        '"]'
    );
  }

  // Read at add-to-cart time rather than tracked on every keystroke: the value
  // lives in the DOM already, and reading it here means a shopper who types and
  // immediately clicks can't outrun a debounce.
  //
  // An empty field emits NO key. Shopify does not drop a blank property — it
  // stores it and the cart renders an empty row — so skipping it is the only
  // way an optional field stays invisible when unused.
  function collectLineProperties(productId) {
    var props = {};
    var els = lineInputsFor(productId);
    for (var i = 0; i < els.length; i++) {
      var control = els[i].querySelector("input, textarea");
      var name = els[i].getAttribute("data-input-name");
      if (!control || !name) continue;
      var value = control.value.trim();
      if (value) props[name] = value;
    }
    return props;
  }

  // Required personalization blocks the add — the merchant can't engrave a
  // blank. Marks every offender so the shopper sees all of them at once, and
  // focuses the first.
  function validateRequiredInputs(productId) {
    var els = lineInputsFor(productId);
    var firstBad = null;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.getAttribute("data-input-required") !== "true") continue;
      var control = el.querySelector("input, textarea");
      if (!control) continue;
      if (control.value.trim()) {
        el.removeAttribute("data-invalid");
      } else {
        el.setAttribute("data-invalid", "true");
        if (!firstBad) firstBad = control;
      }
    }
    if (firstBad) {
      firstBad.focus();
      return false;
    }
    return true;
  }

  // Collapse the lines Shopify would merge anyway — same variant, same selling
  // plan, same properties — into one line carrying the summed quantity.
  //
  // Not cosmetic. Shopify's web-pixels-manager intercepts the /cart/add.js
  // fetch and, for an `items` body, compares the number of items SENT with the
  // number the response returns:
  //
  //   if (t.length !== r.length) throw new g("Payload body and response have
  //     different number of items")
  //
  // and that throw lands in a swallowed `.catch`. So a bundle tier that posts
  // three identical unit lines gets one merged line back, the check fails, and
  // `product_added_to_cart` is never published — no Meta AddToCart, no console
  // error, nothing. Merging here makes the two counts agree. The resulting cart
  // is identical either way (Shopify merges server-side regardless), and unit
  // lines that genuinely differ — a different variant, or bxgy's
  // `_bundle_type: get|buy` — keep their own line. First-seen order is
  // preserved, which is what keeps bxgy's GET lines ahead of the BUY lines.
  function mergeIdenticalItems(items) {
    var merged = [];
    var byKey = Object.create(null);
    items.forEach(function (item) {
      var props = item.properties || {};
      // JSON of the SORTED pairs, so a different key order can't split two
      // identical property bags into two lines Shopify would merge back anyway.
      var key = JSON.stringify([
        String(item.id),
        item.selling_plan == null ? null : String(item.selling_plan),
        Object.keys(props)
          .sort()
          .map(function (name) {
            return [name, props[name]];
          }),
      ]);
      var existing = byKey[key];
      if (existing) {
        existing.quantity = (existing.quantity || 1) + (item.quantity || 1);
        return;
      }
      byKey[key] = item;
      merged.push(item);
    });
    return merged;
  }

  dm.addToCart = function (productId) {
    var s = stateFor(productId);
    var variantId = resolveVariantId(productId, s);
    if (variantId == null) return Promise.resolve(null);
    if (!validateRequiredInputs(productId)) return Promise.resolve(null);

    var lineProps = collectLineProperties(productId);
    var hasLineProps = Object.keys(lineProps).length > 0;

    var items;
    if (s.bundle && s.bundle.bar) {
      items = buildBundleItems(productId, variantId, s.bundle);
      // Every bundle line is the same personalized product, so the engraving
      // rides all of them — merged UNDER the bundle's own `_bundle_type` /
      // `_bar_id`, which the discount Function keys off and must not lose.
      if (hasLineProps) {
        items.forEach(function (item) {
          item.properties = Object.assign({}, lineProps, item.properties);
        });
      }
    } else {
      var item = { id: variantId, quantity: s.quantity || 1 };
      if (s.sellingPlanId != null) item.selling_plan = s.sellingPlanId;
      if (hasLineProps) item.properties = lineProps;
      items = [item];
    }
    return fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ items: mergeIdenticalItems(items) }),
    }).then(function (res) {
      if (res.ok) return res.json();
      // Shopify answers a refused line with a JSON body carrying its own
      // reason ({status, message, description}), already localized to the
      // storefront's language. Carry it on the error rather than discarding
      // it for a status code — reception below shows it to the shopper, and
      // that body is the only thing we have to show.
      return res
        .json()
        .catch(function () { return null; })
        .then(function (body) {
          var err = new Error("cart add failed (" + res.status + ")");
          err.status = res.status;
          err.body = body;
          throw err;
        });
    });
  };

  // Cart UI that shows the add on its own, so the /cart fallback below must
  // stand down. Two kinds match: our own published drawer (dm-cart.js
  // intercepts this /cart/add.js fetch, refreshes the drawer and opens it),
  // and — when the merchant turned our drawer OFF — the host theme's own AJAX
  // cart. Dawn and its descendants ship `<cart-drawer>` / `<cart-notification>`
  // and surface the add themselves, so navigating to /cart discards the drawer
  // the theme just opened. Adding a theme's own selector here is the single
  // per-theme tweak this needs — same seam as TRIGGER_SELECTOR in dm-cart.js.
  // A theme with no AJAX cart at all matches nothing and still gets /cart.
  var CART_UI_SELECTOR = [
    'dm-sheet[data-sheet-open-on="cart"]',
    "cart-drawer",
    "cart-notification",
    "#CartDrawer",
    "[data-cart-drawer]",
  ].join(",");

  // ── ATC button clicks ────────────────────────────────────────────────
  // Document-level delegation — a deliberate exception to the
  // per-element-custom-element rule: the Button publishes as a plain <a>
  // (no custom element to hook), and cart submission is cross-cutting
  // state consumption, which is exactly this hub's job. The edit canvas
  // never adds to cart (`data-dm-edit` gate — clicks select the atom).
  document.addEventListener("click", function (e) {
    var target = e.target;
    if (!target || !target.closest) return;
    var btn = target.closest('[data-button-action="add-to-cart"]');
    if (!btn) return;
    e.preventDefault();
    if (simulated()) return;
    if (btn.hasAttribute("data-loading")) return;
    var productId = btn.getAttribute("data-dm-product-id");
    if (!productId) return;
    btn.setAttribute("data-loading", "true");
    dm.addToCart(productId)
      .then(function (result) {
        btn.removeAttribute("data-loading");
        if (!result) return;
        dm.emit("dm:cart-added", { productId: productId, result: result });
        // Open the cart. Anything in CART_UI_SELECTOR — our drawer, or the
        // theme's own when ours is off — already shows the add, so skip the
        // navigation. Fall back to /cart only when nothing on the page will.
        if (!document.querySelector(CART_UI_SELECTOR)) {
          window.location.href = "/cart";
        }
      })
      .catch(function (err) {
        btn.removeAttribute("data-loading");
        dm.emit("dm:cart-error", {
          productId: productId,
          message: String((err && err.message) || err),
          status: (err && err.status) || 0,
          reason: (err && err.body && (err.body.description || err.body.message)) || "",
        });
      });
  });

  // ── Scroll-to-top links ──────────────────────────────────────────────
  // The `top` smart-link type resolves to `#top` (link/model.ts +
  // dm-resolve-link.liquid) — a spec-defined fragment, so the native jump
  // already works with no JS. This upgrades it to a smooth scroll and keeps
  // the hash out of the URL. Same delegation exception as the ATC block
  // above: Link + Button both publish as a plain <a>, no element to hook.
  //
  // The window is not always the scroller. Horizon (≥990px) pins html/body
  // at `overflow: hidden` and scrolls a `.page-wrapper` div; the builder
  // preview scrolls `[data-canvas-root]`. `window.scrollTo` is a no-op there,
  // and preventDefault has already cancelled the native jump — so every
  // scrolled ancestor of the link is rewound too, with no theme names.
  document.addEventListener("click", function (e) {
    var target = e.target;
    if (!target || !target.closest) return;
    var link = target.closest('a[href="#top"]');
    if (!link) return;
    e.preventDefault();
    if (document.documentElement.hasAttribute("data-dm-edit")) return;
    for (var el = link.parentElement; el; el = el.parentElement) {
      if (el.scrollTop > 0) el.scrollTo({ top: 0, behavior: "smooth" });
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // ── Form Group submit (newsletter / contact) ─────────────────────────
  // A Group with an `action` renders as a real <form> POSTing to /contact.
  // Shopify's customer form carries no CSRF token — just `form_type` + `utf8`
  // hidden inputs — so the markup is ordinary HTML we can emit ourselves.
  //
  // The form is real (rather than us fetching /contact from thin air) because
  // Shopify's invisible spam protection attaches itself to forms carrying a
  // `form_type` input. Posting `new FormData(form)` carries whatever token it
  // injected; a hand-built body would look like a bot and get dropped silently.
  //
  // Same document-level delegation as the ATC button, for the same reason: our
  // Button renders a <div>, so it can never submit a form natively.
  document.addEventListener("click", function (e) {
    var target = e.target;
    if (!target || !target.closest) return;
    var btn = target.closest('[data-button-action="submit"]');
    if (!btn) return;
    e.preventDefault();
    if (simulated()) return;
    if (btn.hasAttribute("data-loading")) return;
    var form = btn.closest("form[data-form-action]");
    if (!form) return;

    // The browser runs `required` / `type=email` constraints on native submit
    // only — a <div> click bypasses all of it, so ask for them explicitly.
    if (form.reportValidity && !form.reportValidity()) return;

    btn.setAttribute("data-loading", "true");
    var f = window.__dmOrigFetch || window.fetch;
    f(form.getAttribute("action") || "/contact", {
      method: "POST",
      body: new FormData(form),
    })
      .then(function (res) {
        btn.removeAttribute("data-loading");
        // /contact answers with the full HTML page, never JSON — the status is
        // the only signal there is, and it's enough.
        if (!res || !res.ok) {
          throw new Error("form post failed (" + (res && res.status) + ")");
        }
        form.setAttribute("data-form-state", "success");
        dm.emit("dm:form-submitted", {
          action: form.getAttribute("data-form-action"),
        });
      })
      .catch(function (err) {
        btn.removeAttribute("data-loading");
        form.setAttribute("data-form-state", "error");
        dm.emit("dm:form-error", {
          message: String((err && err.message) || err),
        });
      });
  });

  // A native (JS-less) submit lands back on the page with ?customer_posted=true
  // — that query param is the entire success signal Shopify gives a theme, and
  // `form.posted_successfully?` is literally a read of it. Which means it can't
  // distinguish WHICH form posted: with two customer forms on one page, both
  // show success. That's Shopify's limitation, not ours, and every theme
  // (including Dawn) has it.
  if (window.location.search.indexOf("customer_posted=true") !== -1) {
    document.querySelectorAll("form[data-form-action]").forEach(function (form) {
      form.setAttribute("data-form-state", "success");
    });
  }

  // ── Centralized reception ────────────────────────────────────────────
  // Bound carousels (`data-bind="product.media"`) slide to the resolved
  // variant's media slide. Slides carry `data-slide-variant-id` (comma-
  // joined for variants whose featured_media matches). Loop-aware:
  //  - Filter Swiper clones (`.swiper-slide-duplicate`) so `i` is a real
  //    index, not a position in the cloned superset.
  //  - Compare against `realIndex` (real slide pos) instead of activeIndex
  //    (includes clones).
  //  - Use `slideToLoop` when available so loop'd carousels navigate by
  //    the original slide position rather than DOM index (which would
  //    target a clone). Falls back to slideTo on non-loop carousels.
  function slideTo(swiper, idx) {
    if (typeof swiper.slideToLoop === "function" && swiper.params && swiper.params.loop) {
      swiper.slideToLoop(idx);
    } else {
      swiper.slideTo(idx);
    }
  }

  // A slide's product-media id: on LEGACY bound slides the expansion loop
  // stamps it on the wrapper; on STATIC gallery slides (placement-filled)
  // the Media element itself carries it (position-resolved to the real id
  // by dm-atom-media.liquid on the storefront; the position verbatim in the
  // editor, where synthetic media ids ARE positions).
  function slideMediaIdOf(slideEl) {
    var id = slideEl.getAttribute("data-slide-media-id");
    if (id) return id;
    var inner = slideEl.querySelector("[data-slide-media-id]");
    return inner ? inner.getAttribute("data-slide-media-id") : null;
  }

  // Same two shapes for the variant-id list, and for the same reason: the
  // legacy expansion loop stamps it on the slide wrapper, while a static
  // gallery slide carries it on the Media element dm-atom-media.liquid
  // rendered. Reading only the wrapper (what shipped) meant the preferred
  // variant-id path never fired on a placement-filled gallery — it silently
  // fell through to the media-id fallback, which is exactly the ordering the
  // position lookup was supposed to stop depending on.
  function slideVariantIdsOf(slideEl) {
    var ids = slideEl.getAttribute("data-slide-variant-id");
    if (ids) return ids;
    var inner = slideEl.querySelector("[data-slide-variant-id]");
    return inner ? inner.getAttribute("data-slide-variant-id") : null;
  }

  function slideToVariant(el, swiper, variant) {
    // `swiper.el` (the main .swiper) — NOT the host: the host may also hold
    // the derived thumb strip, whose slides duplicate the media-id attrs.
    var root = swiper.el || el;
    var slides = root.querySelectorAll(".swiper-slide");
    var target = String(variant.id);
    var fmId =
      variant.featured_media_id != null ? String(variant.featured_media_id) : null;
    for (var i = 0; i < slides.length; i++) {
      // Legacy bound slides match by the variant-id list the expansion loop
      // stamped; static gallery slides match the variant's featured media id
      // against the slide's media id. Either hit wins.
      var vAttr = slideVariantIdsOf(slides[i]);
      var matched = vAttr && vAttr.split(",").indexOf(target) !== -1;
      if (!matched && fmId) {
        matched = slideMediaIdOf(slides[i]) === fmId;
      }
      if (matched) {
        // Real index of the matched slide. Loop mode ROTATES the slide DOM
        // (v12 loopFix moves real slides; no `.swiper-slide-duplicate`
        // clones since v9), so DOM position goes stale after a wrap. Prefer
        // `data-swiper-slide-index` (the original index Swiper stamps in
        // loop mode); fall back to DOM position for non-loop, where the DOM
        // never moves.
        var attr = slides[i].getAttribute("data-swiper-slide-index");
        var realIdx = attr != null ? parseInt(attr, 10) : NaN;
        if (isNaN(realIdx)) realIdx = i;
        if (realIdx < 0 || swiper.realIndex === realIdx) return;
        swiper.__dmProgrammatic = true;
        slideTo(swiper, realIdx);
        requestAnimationFrame(function () { swiper.__dmProgrammatic = false; });
        return;
      }
    }
  }

  // ── syncVariants — single source of variant-state DOM sync ──────────
  // One function that reads the current option selection from the DOM and
  // pushes every variant-derived value back out:
  //   1. Per-card bindings (variant.price / variant.compare_at_price on
  //      each OptionPicker card — hypothetical variant for "this card's
  //      value + other current selections")
  //   2. Top-level bindings (product.price / product.compare_at_price text
  //      nodes anywhere on the page scoped to this product)
  //   3. Bound carousels (slide to the resolved variant's featured_media),
  //      unless the caller passes `{ slideCarousels: false }` — see the
  //      dm:variant-resolved listener.
  // Idempotent. Future Dropdown atom will plug into the same flow —
  // emit dm:option-selected on change, syncVariants reflects across all UI.
  // Exposed on window.dropmagic for external callers (AJAX section refresh,
  // debug tooling).
  function syncVariants(productId, opts) {
    productId = String(productId);
    var product = dm.getProduct(productId);
    if (!product || !product.options || !product.variants) return;

    // Gather currently-active options across BOTH OptionPicker (item
    // cards) AND Dropdown (dropdown items) controls.
    var pickers = document.querySelectorAll(
      '[data-atom-type="option-picker"][data-dm-product-id="' + productId + '"], [data-atom-type="dropdown"][data-dm-product-id="' + productId + '"]'
    );
    var active = {};
    pickers.forEach(function (picker) {
      var optionName = picker.getAttribute("data-option-name");
      if (!optionName) return;
      var activeChild = picker.querySelector(
        '[data-option-picker-item][data-active="true"], [data-dropdown-item][data-active="true"]'
      );
      if (!activeChild) return;
      var value = activeChild.getAttribute("data-variant-value");
      if (value != null) active[optionName] = value;
    });

    // 1. Per-item recompute — OptionPicker cards AND Dropdown items
    //    both surface a hypothetical-variant price. The selector matches
    //    both types; each element carries the same data-variant-value /
    //    data-variant-option-name attrs.
    var items = document.querySelectorAll(
      '[data-option-picker-item][data-dm-product-id="' + productId + '"], [data-dropdown-item][data-dm-product-id="' + productId + '"]'
    );
    items.forEach(function (item) {
      var itemOption = item.getAttribute("data-variant-option-name");
      var itemValue = item.getAttribute("data-variant-value");
      if (!itemOption || itemValue == null) return;

      var hypothetical = {};
      for (var k in active) hypothetical[k] = active[k];
      hypothetical[itemOption] = itemValue;

      // Partial match — constrain only by options that actually have an
      // active selection (skip unselected ones), so a block exposing fewer
      // pickers than the product has options still resolves a price. This
      // mirrors the React render's per-card resolution (option-picker
      // render.tsx finds the first variant matching this one option). A
      // strict all-options match would null out every card whenever any
      // option lacks a picker, wiping the price.
      var match = product.variants.find(function (v) {
        for (var i = 0; i < product.options.length; i++) {
          var opt = product.options[i];
          if (hypothetical[opt.name] == null) continue;
          if (v["option" + (i + 1)] !== hypothetical[opt.name]) return false;
        }
        return true;
      });

      var itemPrice = match ? (match.price_formatted || "") : "";
      var itemCompare = match ? (match.compare_at_price_formatted || "") : "";
      // When a selling plan is active, each option card shows the price UNDER
      // that plan (the allocation's final price — any discount type), struck
      // through with the one-time price when the plan saves money. Keeps every
      // price ("what you'll pay") in sync with the headline (step 2) + the
      // Subscribe card. One-time / no plan → the plain variant price + its own
      // compare-at (above).
      var itemPlanId = stateFor(productId).sellingPlanId;
      if (match && itemPlanId != null) {
        var mAllocs = match.selling_plan_allocations || [];
        var mAlloc = null;
        for (var ma = 0; ma < mAllocs.length; ma++) {
          if (String(mAllocs[ma].id) === String(itemPlanId)) { mAlloc = mAllocs[ma]; break; }
        }
        if (mAlloc) {
          itemPrice = mAlloc.price_formatted || itemPrice;
          itemCompare = mAlloc.savings_formatted ? (match.price_formatted || "") : "";
        }
      }
      item.querySelectorAll('[data-bind="variant.price"]').forEach(function (el) {
        el.textContent = itemPrice;
      });
      item.querySelectorAll('[data-bind="variant.compare_at_price"]').forEach(function (el) {
        el.textContent = itemCompare;
      });
    });

    // 1b. Dropdown trigger labels mirror the active item's content.
    //     We clone [data-dropdown-item-content] from the active item into
    //     [data-dropdown-trigger-label]. Plain innerHTML copy — the item
    //     was already recomputed in step 1 so any variant.* bindings are
    //     current. The trigger label container excludes the check icon.
    document
      .querySelectorAll(
        '[data-atom-type="dropdown"][data-dm-product-id="' + productId + '"]'
      )
      .forEach(function (dropdown) {
        var activeItem = dropdown.querySelector(
          '[data-dropdown-item][data-active="true"] [data-dropdown-item-content]'
        );
        var label = dropdown.querySelector("[data-dropdown-trigger-label]");
        if (activeItem && label) label.innerHTML = activeItem.innerHTML;
      });

    // 1c. Selling-plan card prices — each SellingPlanPicker card shows the
    //     CURRENT variant's price under THAT card's plan
    //     (data-selling-plan-id), the one-time card the plain variant price.
    //     Uses the partial-match variant (like step 1) so a page that
    //     doesn't expose every option picker still re-prices. This is the
    //     cross-picker link: change the format/quantity option → the
    //     subscription price follows. Cards share `data-option-picker-item`
    //     but carry data-selling-plan-id / data-one-time (OptionPicker cards
    //     have neither → skipped).
    var current = product.variants.find(function (v) {
      for (var i = 0; i < product.options.length; i++) {
        var opt = product.options[i];
        if (active[opt.name] == null) continue;
        if (v["option" + (i + 1)] !== active[opt.name]) return false;
      }
      return true;
    });
    if (current) {
      var allocs = current.selling_plan_allocations || [];
      var baseFmt = current.price_formatted || "";
      var baseCompareFmt = current.compare_at_price_formatted || "";
      document
        .querySelectorAll(
          '[data-option-picker-item][data-dm-product-id="' + productId + '"]'
        )
        .forEach(function (card) {
          var planId = card.getAttribute("data-selling-plan-id");
          var isOneTime = card.getAttribute("data-one-time") === "true";
          if (planId == null && !isOneTime) return; // not a selling-plan card
          var priceFmt = "";
          var compareFmt = "";
          var savingsFmt = "";
          var savingsPct = "";
          if (isOneTime) {
            priceFmt = baseFmt;
            compareFmt = baseCompareFmt;
          } else {
            var alloc = null;
            for (var a = 0; a < allocs.length; a++) {
              if (String(allocs[a].id) === planId) { alloc = allocs[a]; break; }
            }
            if (alloc) {
              priceFmt = alloc.price_formatted || "";
              compareFmt = baseFmt; // base IS the strike on a plan card
              savingsFmt = alloc.savings_formatted || "";
              // The plan's saving as "N%" of the variant base (values only —
              // the author writes any "Save"/"off" copy statically).
              if (
                typeof alloc.savings === "number" &&
                alloc.savings > 0 &&
                current.price > 0
              ) {
                savingsPct = Math.round((alloc.savings / current.price) * 100) + "%";
              }
            }
          }
          card.querySelectorAll('[data-bind="selling_plan.price"]').forEach(function (el) {
            el.textContent = priceFmt;
          });
          card.querySelectorAll('[data-bind="selling_plan.compare_at_price"]').forEach(function (el) {
            el.textContent = compareFmt;
          });
          card.querySelectorAll('[data-bind="selling_plan.discount_value"]').forEach(function (el) {
            el.textContent = savingsFmt;
          });
          card.querySelectorAll('[data-bind="selling_plan.discount_percentage"]').forEach(function (el) {
            el.textContent = savingsPct;
          });
        });
    }

    // Resolve a representative variant for the top-level price + carousel.
    // Reuse the partial-match `current` (computed above for selling-plan
    // cards): a page that exposes fewer pickers than the product has options
    // (e.g. Color + Size pickers but no Material control) still resolves —
    // unspecified options fall back to the first matching variant, mirroring
    // the per-card price logic (step 1) and the React render. A strict
    // all-options match previously returned null on such pages, freezing the
    // carousel + top price (they only update once EVERY option has a control).
    var resolved = current;
    if (!resolved) return;

    // Authoritative cart variant. syncVariants gathers active state across
    // BOTH OptionPickers AND Dropdowns (step 0), unlike dm-option-picker.js's
    // own resolver — which scans pickers only and needs a full option tuple,
    // so an option driven by a Dropdown (e.g. a Material dropdown) or a page
    // exposing fewer pickers than options never resolves a variant and the
    // add-to-cart purchase state stays null. Set it here so ATC always has
    // the variant that matches the on-screen price/carousel.
    stateFor(productId).variantId = resolved.id;

    // 2. Top-level product.price / product.compare_at_price text nodes.
    //    When a selling plan is active, the headline reflects what the
    //    customer will pay UNDER that plan: the allocation's final price (any
    //    discount type — %, amount-off, fixed-price — already baked in by
    //    Shopify / planPriceCents), with the base price struck through ONLY
    //    when the plan actually saves money (`savings_formatted` non-empty).
    //    No plan / one-time → the plain variant price + its own compare-at.
    var topPrice = resolved.price_formatted || "";
    var topCompare = resolved.compare_at_price_formatted || "";
    var activePlanId = stateFor(productId).sellingPlanId;
    if (activePlanId != null) {
      var planAllocs = resolved.selling_plan_allocations || [];
      var planAlloc = null;
      for (var pa = 0; pa < planAllocs.length; pa++) {
        if (String(planAllocs[pa].id) === String(activePlanId)) {
          planAlloc = planAllocs[pa];
          break;
        }
      }
      if (planAlloc) {
        topPrice = planAlloc.price_formatted || topPrice;
        topCompare = planAlloc.savings_formatted
          ? (resolved.price_formatted || "")
          : "";
      }
    }

    // 2b. variant.discount_* — the SELECTED variant's compare-at discount,
    //     product-scoped (near the main price): percentage ("N%") + amount saved
    //     (money, from the baked `discount_value_formatted`). Empty when the
    //     variant isn't on sale (so `:empty { display:none }` hides the badge).
    //     Subscription discounts are handled per selling-plan card
    //     (selling_plan.discount_*), NOT here. Mirrors text/render.tsx + dm-text.liquid.
    var vDiscPct = "";
    var vDiscVal = "";
    if (
      resolved.compare_at_price != null &&
      resolved.compare_at_price > resolved.price &&
      resolved.compare_at_price > 0
    ) {
      vDiscPct =
        Math.round(
          ((resolved.compare_at_price - resolved.price) /
            resolved.compare_at_price) *
            100
        ) + "%";
      vDiscVal = resolved.discount_value_formatted || "";
    }
    document.querySelectorAll(
      '[data-bind="variant.discount_percentage"][data-dm-product-id="' + productId + '"]'
    ).forEach(function (el) { el.textContent = vDiscPct; });
    document.querySelectorAll(
      '[data-bind="variant.discount_value"][data-dm-product-id="' + productId + '"]'
    ).forEach(function (el) { el.textContent = vDiscVal; });

    document.querySelectorAll(
      '[data-bind="product.price"][data-dm-product-id="' + productId + '"]'
    ).forEach(function (el) { el.textContent = topPrice; });
    document.querySelectorAll(
      '[data-bind="product.compare_at_price"][data-dm-product-id="' + productId + '"]'
    ).forEach(function (el) { el.textContent = topCompare; });

    // 2c. option_N.selected — the currently-selected value of option N, shown
    //     next to the picker label ("Color: Jet Black"). Product-scoped like
    //     variant.discount_percentage; empty until that option is picked (so :empty
    //     hides the span). `active` (option name → value) was gathered above.
    for (var oi = 0; oi < product.options.length; oi++) {
      var selName = product.options[oi].name;
      var selValue = active[selName] != null ? active[selName] : "";
      document.querySelectorAll(
        '[data-bind="option_' + (oi + 1) + '.selected"][data-dm-product-id="' + productId + '"]'
      ).forEach(function (el) { el.textContent = selValue; });
    }

    // 3. Bound carousels slide to the resolved variant's media (matched by
    //    variant id against `data-slide-variant-id` on swiper slides).
    //    Skipped when the caller opted out (first paint with no shopper
    //    intent) — the gallery then opens on the slide the merchant
    //    authored first, which is the only way that slide is reachable.
    if (!opts || opts.slideCarousels !== false) {
      document.querySelectorAll(
        '[data-bind="product.media"][data-dm-product-id="' + productId + '"]'
      ).forEach(function (el) {
        var swiper = el.__dmSwiper;
        if (swiper) slideToVariant(el, swiper, resolved);
      });
    }
  }
  dm.syncVariants = syncVariants;

  // ── Bundle bars ──────────────────────────────────────────────────────
  // A `<dm-bundle>` carries the resolved tiers as `data-bars` (the
  // `shop_discounts.bar_items` JSON, baked at publish). Each bar card
  // (`[data-bundle-bar][data-bar-id]`) holds `bundle.*` bound spans whose text
  // the runtime fills — static fields straight from the bar, price fields from
  // the live variant price × the bar's discount. The editor fills the same
  // binds in React (text/render.tsx) from the SAME pricing module, so canvas
  // and storefront can't disagree — see the generated block below.
  // dm-bundle.js only selects; pricing is central here.

  // ── data-bars: shape + currency ──────────────────────────────────────
  // `data-bars` is baked at PUBLISH and frozen in the SHOP's currency, while
  // the variant prices it gets priced against come from Liquid, which Shopify
  // Markets has ALREADY converted to the buyer's presentment currency. Mixing
  // them made a fixedPrice tier render full price for any shopper in another
  // currency, while checkout charged the correctly converted amount (the
  // discount Function does its own normalization).
  //
  // Two shapes, because published pages outlive deploys:
  //   {"currency":"NZD","items":[…]}   tagged — since the currency work
  //   [ … ]                            legacy — bare array, assume shop currency
  // Legacy is not a guess: every bar ever baked was in the shop's currency, so
  // an un-republished page converts correctly too and merchants are fixed by
  // the engine push rather than having to republish.
  function parseBars(el) {
    var raw = el.getAttribute("data-bars") || "[]";
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return { currency: null, items: [] };
    }
    if (Array.isArray(parsed)) return { currency: null, items: parsed };
    if (!parsed || typeof parsed !== "object") return { currency: null, items: [] };
    return {
      currency: parsed.currency || null,
      items: Array.isArray(parsed.items) ? parsed.items : []
    };
  }

  /** Shop → presentment rate for bars baked in `bakedCurrency`. 1 when Markets
   *  isn't converting, or when the buyer is already in the baked currency. */
  function presentmentRate(bakedCurrency) {
    var c = window.Shopify && window.Shopify.currency;
    if (!c) return 1;
    // Same currency → nothing to do, and this guards a stale/incoherent rate.
    if (bakedCurrency && c.active && c.active === bakedCurrency) return 1;
    var rate = Number(c.rate);
    return isFinite(rate) && rate > 0 ? rate : 1;
  }

  // Discount math — GENERATED from src/utils/data/bundles/pricing.ts, the one
  // implementation both surfaces run. Edit it there; `pnpm gen:pricing-js`
  // (dev + build) refreshes the block below. Never hand-edit between markers.
  /* @pricing-start AUTO-GENERATED from src/utils/data/bundles/pricing.ts — do not edit here.
     Regenerate with `pnpm gen:pricing-js` (runs on dev + build). */
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
  function percentTotal(baseCents, value, unitPrices) {
    if (!unitPrices.length) return Math.round(baseCents * (1 - value / 100));
    let total = 0;
    for (const price of unitPrices) {
      total += price - Math.floor(price * value / 100);
    }
    return total;
  }
  const DISCOUNTERS = {
    percent: percentTotal,
    amountOff: (base, value) => Math.max(0, base - value),
    fixedPrice: (base, value) => Math.min(base, Math.max(0, value)),
    free: () => 0,
    fullPrice: (base) => base
  };
  const MONEY_PRICE_TYPES = ["amountOff", "fixedPrice"];
  function toPresentmentBar(bar, rate) {
    if (!Number.isFinite(rate) || rate <= 0 || rate === 1) return bar;
    const convert = (cents) => Math.round(cents * rate);
    const converted = MONEY_PRICE_TYPES.includes(bar.priceType) ? __spreadProps(__spreadValues({}, bar), { discountValue: convert(bar.discountValue) }) : bar;
    if (!isBxgy(converted)) return converted;
    return MONEY_PRICE_TYPES.includes(converted.getPriceType) ? __spreadProps(__spreadValues({}, converted), { getDiscountValue: convert(converted.getDiscountValue) }) : converted;
  }
  function applyBarDiscount(baseCents, priceType, value, unitPrices = []) {
    const discount = DISCOUNTERS[priceType];
    return discount ? discount(baseCents, value, unitPrices) : baseCents;
  }
  function isBxgy(bar) {
    return "buyQty" in bar;
  }
  function baseUnitPrice(priceCents, compareAtCents) {
    return compareAtCents != null && compareAtCents > priceCents ? compareAtCents : priceCents;
  }
  function barTierTotals(unitPriceCents, bar, unitCompareAtCents) {
    const baseUnit = baseUnitPrice(unitPriceCents, unitCompareAtCents);
    const repeat = (n) => Array.from({ length: Math.max(0, n) }, () => unitPriceCents);
    if (isBxgy(bar)) {
      const buyUnits = repeat(bar.buyQty);
      const getUnits = repeat(bar.getQty);
      const buySelling = unitPriceCents * bar.buyQty;
      const getSelling = unitPriceCents * bar.getQty;
      return {
        base: baseUnit * (bar.buyQty + bar.getQty),
        discounted: applyBarDiscount(
          buySelling,
          bar.priceType,
          bar.discountValue,
          buyUnits
        ) + applyBarDiscount(
          getSelling,
          bar.getPriceType,
          bar.getDiscountValue,
          getUnits
        )
      };
    }
    const selling = unitPriceCents * bar.quantity;
    return {
      base: baseUnit * bar.quantity,
      discounted: applyBarDiscount(
        selling,
        bar.priceType,
        bar.discountValue,
        repeat(bar.quantity)
      )
    };
  }
  function barTierTotalsFromUnits(units, bar) {
    let base = 0;
    let buySelling = 0;
    let getSelling = 0;
    const buyUnits = [];
    const getUnits = [];
    for (const unit of units) {
      base += baseUnitPrice(unit.priceCents, unit.compareAtCents);
      if (unit.role === "get") {
        getSelling += unit.priceCents;
        getUnits.push(unit.priceCents);
      } else {
        buySelling += unit.priceCents;
        buyUnits.push(unit.priceCents);
      }
    }
    if (isBxgy(bar)) {
      return {
        base,
        discounted: applyBarDiscount(
          buySelling,
          bar.priceType,
          bar.discountValue,
          buyUnits
        ) + applyBarDiscount(
          getSelling,
          bar.getPriceType,
          bar.getDiscountValue,
          getUnits
        )
      };
    }
    return {
      base,
      discounted: applyBarDiscount(
        buySelling + getSelling,
        bar.priceType,
        bar.discountValue,
        [...buyUnits, ...getUnits]
      )
    };
  }
  function resolveBarTokens(text, v) {
    return (text || "").replace(/@product_name\b/g, v.productName).replace(/@saved_total\b/g, v.savedTotal).replace(/@saved_percentage\b/g, `${v.savedPercent}%`).replace(/@buy\b/g, String(v.buyQty)).replace(/@get\b/g, String(v.getQty)).replace(/@quantity\b/g, String(v.quantity));
  }
  /* @pricing-end */

  // The variant bundle tiers price against — the product's currently resolved
  // one (syncVariants keeps `variantId` current), falling back to the first
  // available variant before any selection. Returns the whole variant: tiers
  // need its `compare_at_price` for the struck total, not only its price.
  function bundleUnitVariant(productId) {
    var s = stateFor(productId);
    var variant = s.variantId != null ? dm.getVariant(productId, s.variantId) : null;
    if (!variant) {
      var product = dm.getProduct(productId);
      var variants = (product && product.variants) || [];
      for (var i = 0; i < variants.length; i++) {
        if (variants[i].available) { variant = variants[i]; break; }
      }
      if (!variant && variants.length) variant = variants[0];
    }
    return variant || null;
  }

  // ── Per-unit pickers (BundleUnits) ──────────────────────────────────────
  // Resolve the variant a single unit row selected — match the product's
  // variants against the row's `<select>` values (by option index). Mirrors
  // syncVariants' option→variant match. Null when no variant matches.
  function resolveUnitVariant(productId, unitEl) {
    var product = dm.getProduct(productId);
    if (!product || !product.variants || !product.options) return null;
    var byIndex = Object.create(null);
    var selects = unitEl.querySelectorAll("select[data-dm-bundle-unit]");
    for (var i = 0; i < selects.length; i++) {
      var oi = parseInt(selects[i].getAttribute("data-option-index"), 10);
      if (!isNaN(oi)) byIndex[oi] = selects[i].value;
    }
    for (var v = 0; v < product.variants.length; v++) {
      var variant = product.variants[v];
      var ok = true;
      for (var o = 0; o < product.options.length; o++) {
        if (byIndex[o] == null) continue;
        if (variant["option" + (o + 1)] !== byIndex[o]) {
          ok = false;
          break;
        }
      }
      if (ok) return variant;
    }
    return null;
  }

  // A unit row's prices (cents) — its resolved variant, else the product's
  // current one (so an untouched / unmatched row still totals sanely).
  function unitVariantPrices(productId, unitEl) {
    var v = resolveUnitVariant(productId, unitEl);
    if (!v || typeof v.price !== "number") v = bundleUnitVariant(productId);
    return {
      priceCents: v && typeof v.price === "number" ? v.price : 0,
      compareAtCents: v ? v.compare_at_price : null,
    };
  }

  // Per-UNIT bar totals — sum each unit row's own variant price (bxgy keeps the
  // buy rows full price, discounts the get rows). Returns null when the bar has
  // no per-unit rows → the caller falls back to `barTierTotals(unit, bar)`.
  function barTierTotalsPerUnit(productId, bar, barId) {
    if (!barId) return null;
    var unitEls = document.querySelectorAll(
      '[data-bundle-unit][data-bar-id="' + barId + '"]'
    );
    if (!unitEls.length) return null;
    // Resolve the rows here (this is the DOM half), then hand the prices to the
    // generated math — the split that keeps the totals in ONE place.
    var units = [];
    for (var i = 0; i < unitEls.length; i++) {
      var prices = unitVariantPrices(productId, unitEls[i]);
      units.push({
        priceCents: prices.priceCents,
        compareAtCents: prices.compareAtCents,
        role: unitEls[i].getAttribute("data-unit-role") === "get" ? "get" : "buy",
      });
    }
    return barTierTotalsFromUnits(units, bar);
  }

  function fillBundleBind(card, bind, value) {
    var nodes = card.querySelectorAll('[data-bind="' + bind + '"]');
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = value;
  }

  // Reprice + refill every bar card of every bundle scoped to this product.
  // Empty strings on the price/strike binds let `:empty { display:none }`
  // auto-hide an un-discounted tier's compare/savings, mirroring the editor.
  function syncBundles(productId) {
    productId = String(productId);
    if (!dm.getProduct(productId)) return; // no blob → leave authored placeholders
    var heroVariant = bundleUnitVariant(productId);
    if (!heroVariant || typeof heroVariant.price !== "number") return;

    var bundles = document.querySelectorAll(
      'dm-bundle[data-dm-product-id="' + productId + '"]'
    );
    bundles.forEach(function (el) {
      // Convert ONCE, here, on freshly parsed objects — there is no shared
      // bar object to convert twice, and everything downstream prices against
      // presentment variant prices.
      var parsed = parseBars(el);
      var bars = parsed.items;
      var rate = presentmentRate(parsed.currency);
      var byId = Object.create(null);
      for (var i = 0; i < bars.length; i++) {
        if (bars[i] && bars[i].id) byId[bars[i].id] = toPresentmentBar(bars[i], rate);
      }
      var cards = el.querySelectorAll("[data-bundle-bar]");
      cards.forEach(function (card) {
        var bar = byId[card.getAttribute("data-bar-id")];
        if (!bar) return;

        // Totals first — live variant price × the bar's discounts. When the
        // bar has per-unit picker rows, sum each unit's OWN variant price;
        // else the page's single unit price × the tier quantity. Text fields
        // need the totals too: app-authored bars carry `@saved_total` /
        // `@saved_percentage` tokens in their title/subtitle.
        var t =
          barTierTotalsPerUnit(productId, bar, card.getAttribute("data-bar-id")) ||
          barTierTotals(heroVariant.price, bar, heroVariant.compare_at_price);
        var isDiscounted = t.discounted < t.base;
        var totalQty =
          bar.type === "bxgy" ? bar.buyQty + bar.getQty : bar.quantity;
        var product = dm.getProduct(productId);
        var tokens = {
          savedTotal: dm.formatMoney(Math.max(0, t.base - t.discounted)),
          savedPercent:
            t.base > 0
              ? Math.round(((t.base - t.discounted) / t.base) * 100)
              : 0,
          buyQty: bar.type === "bxgy" ? bar.buyQty : bar.quantity,
          getQty: bar.type === "bxgy" ? bar.getQty : 0,
          quantity: totalQty,
          productName: (product && product.title) || "",
        };

        // Text fields — the shopify-app's `@` tokens resolve on the same
        // totals the price binds show (resolveBarTokens, generated block).
        fillBundleBind(card, "bundle.title", resolveBarTokens(bar.title || "", tokens));
        fillBundleBind(card, "bundle.subtitle", resolveBarTokens(bar.subtitle || "", tokens));
        fillBundleBind(card, "bundle.badge", resolveBarTokens(bar.badge || "", tokens));
        fillBundleBind(card, "bundle.quantity", String(totalQty));
        fillBundleBind(card, "bundle.buy_quantity", String(tokens.buyQty));
        fillBundleBind(
          card,
          "bundle.get_quantity",
          bar.type === "bxgy" ? String(bar.getQty) : ""
        );
        fillBundleBind(card, "bundle.tier_price", dm.formatMoney(t.discounted));
        fillBundleBind(
          card,
          "bundle.compare_at",
          isDiscounted ? dm.formatMoney(t.base) : ""
        );
        fillBundleBind(
          card,
          "bundle.discount_value",
          isDiscounted ? dm.formatMoney(t.base - t.discounted) : ""
        );
        fillBundleBind(
          card,
          "bundle.discount_percentage",
          isDiscounted && t.base > 0
            ? Math.round(((t.base - t.discounted) / t.base) * 100) + "%"
            : ""
        );
      });
    });
  }
  dm.syncBundles = syncBundles;

  // Resolve a bar object from a bundle's baked `data-bars`, given the selected
  // product / bundle / bar ids. The selected tier's full shape drives the cart
  // lines in addToCart.
  function resolveBar(productId, bundleId, barId) {
    var els = document.querySelectorAll(
      'dm-bundle[data-dm-product-id="' + productId + '"]'
    );
    var el = null;
    for (var i = 0; i < els.length; i++) {
      if (!bundleId || els[i].getAttribute("data-bundle-id") === bundleId) {
        el = els[i];
        break;
      }
    }
    if (!el) el = els[0] || null;
    if (!el) return null;
    // NOT currency-converted, deliberately. This feeds the CART lines, which
    // carry only `_bar_id` + quantity; the discount Function prices them
    // server-side from its own config and normalizes that itself. A converted
    // value here would be unused at best and double-counted at worst.
    var items = parseBars(el).items;
    for (var b = 0; b < items.length; b++) {
      if (items[b] && items[b].id === barId) return items[b];
    }
    return null;
  }

  // ── syncOptionControls — mirror an option's active value across every
  //    control (OptionPicker + Dropdown) bound to the same option.
  //    Necessary when a template carries duplicate controls for the same
  //    option (e.g. card-style Material picker AND Material dropdown):
  //    without this, syncVariants gathers in DOM order and last-writer
  //    wins, so a click on one control gets overridden by a stale value
  //    on the other.
  function syncOptionControls(productId, optionName, value) {
    if (!productId || !optionName) return;
    var controls = document.querySelectorAll(
      '[data-atom-type="option-picker"][data-dm-product-id="' + productId + '"][data-option-name="' + optionName + '"], [data-atom-type="dropdown"][data-dm-product-id="' + productId + '"][data-option-name="' + optionName + '"]'
    );
    controls.forEach(function (control) {
      var items = control.querySelectorAll(
        '[data-option-picker-item], [data-dropdown-item]'
      );
      items.forEach(function (item) {
        var match = item.getAttribute("data-variant-value") === value;
        item.setAttribute("data-active", match ? "true" : "false");
        if (item.hasAttribute("data-dropdown-item")) {
          item.setAttribute("aria-selected", match ? "true" : "false");
        }
      });
    });
  }

  // Fire on every option click AND on initial paint (variant-resolved is
  // emitted by runInitial). Double-fire on user click is harmless —
  // syncVariants is idempotent. The dm:variant-resolved event still
  // exists for external consumers (cart, analytics, …).
  dm.on("dm:option-selected", function (d) {
    syncOptionControls(d.productId, d.optionName, d.value);
    syncVariants(d.productId);
    syncBundles(d.productId);
  });
  // On FIRST PAINT the picker has not been touched: dm-option-picker.js emits
  // `initial: true` after defaulting to `?variant=` > first available > first.
  // Only the `?variant=` case is the shopper asking for a variant
  // (`requested: true`); the fallbacks are our own pick. Sliding the bound
  // gallery for those fallbacks drops the shopper wherever that variant's
  // featured image happens to sit — on a 6-colour product whose colour shots
  // come after the lifestyle shots, that is most of the way down the track,
  // and with `loop` on, swiping from there wraps straight past the start. The
  // merchant's first slide is the hero they authored, and nothing in the page
  // tree can ask for it, so first paint keeps it unless the shopper deep-linked
  // a variant. Every other value (prices, add-to-cart state, bindings) still
  // syncs, and any later option click slides as before.
  dm.on("dm:variant-resolved", function (d) {
    stateFor(d.productId).variantId = d.variantId;
    syncVariants(d.productId, { slideCarousels: !d.initial || !!d.requested });
    syncBundles(d.productId);
  });

  // Bundle tier chosen (or auto-selected on first paint by dm-bundle.js).
  // Record it for add-to-cart and price the bars (covers a page with a bundle
  // but no option picker — no dm:variant-resolved would otherwise fire).
  dm.on("dm:bundle-selected", function (d) {
    if (!d.productId) return;
    var bar = resolveBar(d.productId, d.bundleId, d.barId);
    stateFor(d.productId).bundle = {
      bundleId: d.bundleId,
      barId: d.barId,
      bar: bar,
    };
    syncBundles(d.productId);
  });

  // A per-unit picker (BundleUnits `<select>`) changed — reprice the bar from
  // the new per-unit variants, and swap the row's thumbnail to the resolved
  // variant's image (`featured_media_src` in the product blob; rows whose
  // variant has no own image keep their current thumb). The cart lines are
  // read from the DOM at ATC, so there's no per-unit state to store here.
  dm.on("dm:bundle-unit-changed", function (d) {
    if (!d.productId) return;
    if (d.barId != null && d.unitIndex != null) {
      var unitEl = document.querySelector(
        '[data-bundle-unit][data-bar-id="' + d.barId + '"][data-unit-index="' + d.unitIndex + '"]'
      );
      if (unitEl) {
        // Resolve the row's variant BEFORE the thumbnail test — the bound
        // gallery below needs it whether or not this row draws a thumb.
        var uv = resolveUnitVariant(d.productId, unitEl);
        var thumb = unitEl.querySelector("[data-bundle-unit-thumb]");
        if (thumb && uv && uv.featured_media_src) thumb.src = uv.featured_media_src;
        // Bound galleries follow the unit's variant too — same contract as the
        // OptionPicker path (syncVariants step 3). A bundle-only page never
        // reached it: syncVariants gathers active options from OptionPicker /
        // Dropdown controls, and a BundleUnits <select> is neither, so it
        // resolved no variant and the gallery sat on slide 1 while the row
        // thumbnail updated. Last row changed wins — the feedback belongs to
        // the pick the shopper just made.
        if (uv) {
          document
            .querySelectorAll(
              '[data-bind="product.media"][data-dm-product-id="' + d.productId + '"]'
            )
            .forEach(function (el) {
              var swiper = el.__dmSwiper;
              if (swiper) slideToVariant(el, swiper, uv);
            });
        }
      }
    }
    syncBundles(d.productId);
  });

  // Purchase-state feeds for add-to-cart (no DOM sync — just the map).
  dm.on("dm:selling-plan-changed", function (d) {
    stateFor(d.productId).sellingPlanId = d.sellingPlanId;
    // Re-render selling-plan card prices for the newly chosen plan (the
    // active subscribe card's data-selling-plan-id was just updated).
    syncVariants(d.productId);
  });
  dm.on("dm:quantity-changed", function (d) {
    stateFor(d.productId).quantity = d.quantity || 1;
  });

  // Input atom. The two cart-LEVEL actions write straight through — they are
  // cart state, not purchase state, and they must survive a shopper who fills
  // the note and then leaves without adding anything. The line-property action
  // deliberately does nothing here: those values are read out of the DOM at
  // add-to-cart time (see `collectLineProperties`), so there is no buffered
  // copy to go stale.
  dm.on("dm:input-changed", function (d) {
    if (d.action === "cart-note") {
      writeCart({ note: d.value });
    } else if (d.action === "cart-attribute" && d.name) {
      var attrs = {};
      // An empty string CLEARS the attribute, which is what an emptied field
      // should mean — so unlike line properties, don't skip the blank case.
      attrs[d.name] = d.value;
      writeCart({ attributes: attrs });
    }
  });

  // Sibling-sync carousels (`data-list-sync-siblings="true"`) on the same
  // product follow the emitter's real-slide index. The emitter is also
  // matched by the selector but its swiper's realIndex equals d.slideIndex,
  // so the inner check no-ops.
  dm.on("dm:carousel-slide-changed", function (d) {
    var productId = String(d.productId);
    document
      .querySelectorAll(
        '[data-list-sync-siblings="true"][data-dm-product-id="' + productId + '"]'
      )
      .forEach(function (el) {
        var swiper = el.__dmSwiper;
        if (!swiper || swiper.realIndex === d.slideIndex) return;
        swiper.__dmProgrammatic = true;
        slideTo(swiper, d.slideIndex);
        requestAnimationFrame(function () { swiper.__dmProgrammatic = false; });
      });
  });

  // A refused `/cart/add.js` used to be SILENT — `dm:cart-error` was emitted
  // and nothing listened, so the button un-spun and the shopper was left
  // clicking a button that did nothing.
  //
  // We show Shopify's own reason, which is precise ("You can only add 2 of
  // this to your cart") and arrives already translated into the storefront's
  // language. The ONE string we refuse to repeat is "sold out":
  //
  //   Shopify returns a BYTE-IDENTICAL 422 "The product 'X' is already sold
  //   out." both for a genuinely out-of-stock variant AND for a visitor whose
  //   country is not in an active market. Verified against both cases on one
  //   store, 2026-09-11 — same status, same message, same description.
  //
  // Nothing on the page separates them either: the market-blocked render also
  // reports the variant as `"available": false`. So repeating "sold out" would
  // strand a shopper waiting for a restock that is not the problem, and
  // claiming "not available in your region" would be a lie about a real
  // sold-out. Until a trustworthy market signal exists, say neither, and
  // branch HERE when one does.
  //
  // The fallback is English-only, unlike Shopify's localized strings — a real
  // gap on a non-English storefront, and the reason to prefer `reason` when
  // it is usable.
  var cartToastTimer = null;

  function showCartToast(text) {
    var host = document.querySelector(".dm-cart-toast");
    if (!host) {
      host = document.createElement("div");
      host.className = "dm-cart-toast";
      // Announced, not focus-stealing: the shopper's focus stays on the
      // button they just pressed.
      host.setAttribute("role", "status");
      host.setAttribute("aria-live", "polite");
      document.body.appendChild(host);
    }
    host.textContent = text;
    // Drop and re-add so a second failure replays the entrance instead of
    // sitting there looking like the first toast never left.
    host.removeAttribute("data-visible");
    void host.offsetWidth;
    host.setAttribute("data-visible", "true");
    if (cartToastTimer) clearTimeout(cartToastTimer);
    cartToastTimer = setTimeout(function () {
      host.removeAttribute("data-visible");
    }, 6000);
  }

  // Matching Shopify's localized sold-out wording is best-effort — these are
  // its strings, not ours, and a locale we haven't listed slips through.
  // That failure mode is deliberate and safe: an unmatched string is shown
  // verbatim, i.e. exactly what a stock Shopify theme would have said, so we
  // are never WORSE than the default — only better where we recognize it.
  var SOLD_OUT_WORDING =
    /sold out|agotado|rupture de stock|épuisé|epuise|ausverkauft|esaurito|uitverkocht|esgotado/i;

  dm.on("dm:cart-error", function (d) {
    var reason = (d && d.reason) || "";
    var ambiguous = !reason || SOLD_OUT_WORDING.test(reason);
    showCartToast(
      ambiguous ? "This item can't be added to your cart right now." : reason
    );
  });
})();
