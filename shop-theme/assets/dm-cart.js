/**
 * dm-cart.js — the sidecart controller (storefront only).
 *
 * The cart drawer is a `<dm-sheet data-sheet-open-on="cart">` published into
 * footer-group.json (so it renders on every page). dm-sheet.js owns the
 * open/close/slide mechanics; THIS file is the integration layer between the
 * drawer and the host theme's cart:
 *
 *   1. Hijack the theme's cart trigger (the header cart icon/link) → open the
 *      DropMagic drawer instead of navigating to /cart or the theme's own
 *      drawer.
 *   2. Wire the in-drawer `cart-increase` / `cart-decrease` / `cart-remove`
 *      buttons → POST /cart/change.js, then re-render the drawer from the
 *      returned section HTML (Section Rendering API).
 *   3. Intercept AJAX cart mutations (/cart/add|change|update|clear.js) made by
 *      ANY script — the theme's native add-to-cart, DropMagic's own ATC
 *      (dm-dropmagic.js) — and refresh the drawer; open it on add.
 *
 * Document-level delegation + a window.fetch patch are deliberate exceptions to
 * the per-element-custom-element rule (src/components/builder/AGENTS.md): the
 * cart trigger is a THEME element we don't own, and cart mutations are
 * cross-cutting. This is the one theme-specific seam. The drawer's own
 * change/refresh calls use the ORIGINAL fetch so they bypass the patch (no
 * refresh loop). Edit canvas never runs any of this (`data-dm-edit` gate).
 *
 * Plain ES2017, IIFE-wrapped, idempotent.
 */
(function () {
  if (window.__dmCartInit) return;
  window.__dmCartInit = true;

  // Preserve the un-patched fetch for our own calls (so they aren't seen by
  // the intercept below — avoids a refresh loop).
  var origFetch = window.fetch.bind(window);

  // Published for the other dm scripts that need a cart write the drawer must
  // NOT react to. The cart-note field is the case that forces this: it lives in
  // the drawer, so refreshing the drawer on its own debounced write would
  // re-render the very textarea being typed into and throw away the caret
  // mid-sentence. A note write changes no line and no count — there is nothing
  // for the drawer to re-render anyway.
  window.__dmOrigFetch = origFetch;

  function inEditor() {
    return document.documentElement.hasAttribute("data-dm-edit");
  }

  // Escape a dynamic value for safe interpolation into markup (the optimistic
  // line is built by string-replacing tokens then parsing) — mirrors the
  // `| escape` the Liquid loop applies to the same fields.
  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getDrawer() {
    return document.querySelector('dm-sheet[data-sheet-open-on="cart"]');
  }

  // The drawer lives in footer-group, so its section id is the THEME-assigned
  // qualified form (`sections--<n>__dm-cart-drawer`), NOT the bare key — read it
  // off the `shopify-section-…` wrapper. This is what the Section Rendering API
  // (`?sections=<id>`) + the cart `sections` param both key on.
  function getSectionId() {
    var drawer = getDrawer();
    if (!drawer) return null;
    var section = drawer.closest('[id^="shopify-section-"]');
    return section ? section.id.replace(/^shopify-section-/, "") : null;
  }

  // ── Open / refresh ───────────────────────────────────────────────────────
  function openCart() {
    var drawer = getDrawer();
    if (!drawer) return;
    // dm-sheet.js defines <dm-sheet> with .open(); fall back to the attribute.
    if (typeof drawer.open === "function") drawer.open();
    else drawer.setAttribute("data-state", "open");
  }

  function isDrawerOpen() {
    var drawer = getDrawer();
    return !!drawer && drawer.getAttribute("data-state") === "open";
  }

  // Loading mask while a refresh is in flight (CSS: dm-sheet[data-cart-loading]).
  // "hide" blanks the body (add: it's the empty state); "dim" keeps it inert
  // (qty/remove); falsy clears. Every refresh terminal MUST clear it.
  function setLoading(mode) {
    var drawer = getDrawer();
    if (!drawer) return;
    if (mode) drawer.setAttribute("data-cart-loading", mode);
    else drawer.removeAttribute("data-cart-loading");
  }

  // Swap the drawer body in place from a parsed source (Document or Element) —
  // preserves the open <dm-sheet> + its bound listeners. The source markup is a
  // fresh server render, so empty↔filled body, line list, subtotal, and
  // cart-goal fill are all current. Returns true if it swapped.
  function applyPanel(sourceRoot) {
    if (!sourceRoot) return false;
    var live = getDrawer();
    if (!live) return false;
    var next = sourceRoot.querySelector('dm-sheet[data-sheet-open-on="cart"]');
    if (!next) return false;
    var livePanel = live.querySelector(".dm-sheet__panel");
    var nextPanel = next.querySelector(".dm-sheet__panel");
    if (!livePanel || !nextPanel) return false;
    livePanel.innerHTML = nextPanel.innerHTML;
    // Reconcile the body toggle from the fresh (authoritative) server render —
    // applyPanel only swaps the panel innerHTML, not the <dm-sheet> attrs, so a
    // refresh after the cart emptied/filled must move `data-cart-empty` too
    // (otherwise an optimistic flip would never be corrected).
    var emptyState = next.getAttribute("data-cart-empty");
    if (emptyState != null) live.setAttribute("data-cart-empty", emptyState);
    return true;
  }

  // ── Cart-count bubble sync ─────────────────────────────────────────────────
  // The header cart-count bubble is a Text atom bound to cart.item_count
  // (data-bind="cart.item_count"). The drawer refresh re-renders the DRAWER
  // section, never the header, so without this the bubble goes stale after a
  // DropMagic cart mutation. Sync every bound element's textContent from the
  // fresh count — same pattern as dm-dropmagic.js's [data-bind] price sync.
  function countEls() {
    return document.querySelectorAll('[data-bind="cart.item_count"]');
  }

  function syncCartCount(count) {
    if (count == null || isNaN(count)) return;
    var n = Math.max(0, count | 0);
    var els = countEls();
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      // A whole-bind count bubble (the Text atom's outer element) hides at 0 via
      // the `[data-atom-type='text'][data-bind]:empty` CSS rule, so blank it.
      // Sub-text spans (data-bind inside composed copy) keep the literal number.
      var isBubble = el.getAttribute("data-atom-type") === "text";
      el.textContent = n === 0 && isBubble ? "" : String(n);
    }
  }

  // Current displayed count — first bubble wins; used for optimistic deltas.
  function currentCount() {
    var el = countEls()[0];
    if (!el) return null;
    var n = parseInt(el.textContent, 10);
    return isNaN(n) ? 0 : n;
  }

  // Authoritative count straight from the cart — reconciles after a mutation
  // whose response we don't parse (/cart/add returns the line, not item_count).
  function refreshCartCount() {
    if (!countEls().length) return; // no bubble on the page → nothing to sync
    origFetch("/cart.js", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (data) syncCartCount(data.item_count);
      })
      .catch(function () {});
  }

  // Re-render the drawer for the current cart. Fast path = Section Rendering API
  // (`?sections=<id>`); if that doesn't return usable HTML (some themes don't
  // resolve section-GROUP sections via the API), fall back to fetching the full
  // page and extracting the drawer section by its DOM id — exactly the render a
  // reload produces, so it ALWAYS reflects the current cart.
  // `done` runs after the refresh settles (success OR failure) — used to
  // open-after-fill so the first-add empty→filled morph never shows.
  function refreshDrawer(done) {
    var sectionId = getSectionId();
    if (!sectionId) {
      setLoading(null);
      if (done) done();
      return;
    }
    origFetch(
      window.location.pathname + "?sections=" + encodeURIComponent(sectionId),
      // no-store — the section response is cacheable, and a 304 served the STALE
      // (e.g. empty) cart, which morphed the drawer to the wrong state then
      // corrected via the fallback = a visible blink. Always fetch live.
      { headers: { Accept: "application/json" }, cache: "no-store" }
    )
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        // Accept the section under its exact id OR any returned key for the
        // cart-drawer (group-section response keys can differ from the id sent).
        var html = null;
        if (data && typeof data[sectionId] === "string") {
          html = data[sectionId];
        } else if (data) {
          for (var k in data) {
            if (
              typeof data[k] === "string" &&
              k.indexOf("dm-cart-drawer") !== -1
            ) {
              html = data[k];
              break;
            }
          }
        }
        if (html) {
          var doc = new DOMParser().parseFromString(html, "text/html");
          if (applyPanel(doc)) {
            setLoading(null);
            if (done) done();
            return;
          }
        }
        refreshDrawerFromPage(sectionId, done);
      })
      .catch(function () {
        refreshDrawerFromPage(sectionId, done);
      });
  }

  // Bulletproof fallback — fetch the current page HTML and lift the drawer
  // section out of it by `#shopify-section-<id>`.
  function refreshDrawerFromPage(sectionId, done) {
    origFetch(window.location.href, {
      headers: { Accept: "text/html" },
      cache: "no-store",
    })
      .then(function (r) {
        return r.ok ? r.text() : null;
      })
      .then(function (html) {
        if (html) {
          var doc = new DOMParser().parseFromString(html, "text/html");
          var section = doc.getElementById("shopify-section-" + sectionId);
          applyPanel(section || doc);
        }
        setLoading(null);
        if (done) done();
      })
      .catch(function () {
        // leave the stale drawer rather than break the page, but never leave
        // the spinner stuck — and still open it (filled if we got that far).
        setLoading(null);
        if (done) done();
      });
  }

  // ── Line quantity / remove ─────────────────────────────────────────────────
  // POST the change WITH the drawer section so the response can carry fresh
  // markup in one round-trip; fall back to a refresh if it doesn't. Uses
  // origFetch to stay out of the intercept.
  function changeLine(key, quantity) {
    var sectionId = getSectionId();
    origFetch("/cart/change.js", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        id: key,
        quantity: quantity,
        sections: sectionId,
        sections_url: window.location.pathname,
      }),
    })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        // /cart/change.js returns the whole cart → reconcile the bubble from
        // its authoritative item_count (corrects the optimistic delta below).
        if (data) syncCartCount(data.item_count);
        if (
          sectionId &&
          data &&
          data.sections &&
          typeof data.sections[sectionId] === "string"
        ) {
          var doc = new DOMParser().parseFromString(
            data.sections[sectionId],
            "text/html"
          );
          if (applyPanel(doc)) {
            setLoading(null);
            return;
          }
        }
        refreshDrawer();
      })
      .catch(function () {
        refreshDrawer();
      });
  }

  // ── Optimistic add ─────────────────────────────────────────────────────────
  // Render the just-added line(s) from the /cart/add.js response BEFORE the
  // server reconcile, so the drawer opens instantly already-filled (no
  // round-trip, no empty→filled morph). The drawer ships a <template
  // data-cart-line-template> (raw `__DM_L_*` tokens — see dm-cart-items.liquid);
  // we clone it, fill the tokens client-side, and append/bump. refreshDrawer()
  // then swaps in the authoritative server render moments later.

  // Find the rendered line a response item maps to. The /cart/add.js response
  // line `key` is unreliable (often absent on add), so match on the exact key
  // when present, then fall back to variant id + selling plan — Shopify merges
  // same-variant+same-plan into ONE line, so that's the line the server bumps.
  // Without this fallback a re-add appends a phantom duplicate that the reconcile
  // then folds away (visible flash).
  function findLine(cartItems, item) {
    var lines = cartItems.querySelectorAll("[data-cart-line-key]");
    var key = item.key != null ? String(item.key) : "";
    if (key) {
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].getAttribute("data-cart-line-key") === key) return lines[i];
      }
    }
    var variantId =
      item.variant_id != null
        ? String(item.variant_id)
        : item.id != null
        ? String(item.id)
        : "";
    if (!variantId) return null;
    var plan =
      item.selling_plan_allocation &&
      item.selling_plan_allocation.selling_plan &&
      item.selling_plan_allocation.selling_plan.id != null
        ? String(item.selling_plan_allocation.selling_plan.id)
        : "";
    for (var j = 0; j < lines.length; j++) {
      if (
        lines[j].getAttribute("data-cart-line-variant-id") === variantId &&
        (lines[j].getAttribute("data-cart-line-selling-plan") || "") === plan
      ) {
        return lines[j];
      }
    }
    return null;
  }

  // Build one line node from a response line-item by filling the clone template.
  //
  // We deliberately fill ONLY values that are exactly known from the user's
  // action + the add response: title, variant, quantity, image, selling-plan
  // name, and the match ids. EVERY price/discount field is left blank — they
  // `:empty`-hide and the section reconcile (~150ms) fills the authoritative
  // figures. Reason: /cart/add.js doesn't reliably compute cart / automatic /
  // bundle discounts onto the added line, so any amount we rendered here could
  // be wrong for that window. Founder rule: never show a wrong price — a price
  // that briefly loads in is honest; a price that's briefly wrong is not.
  function buildLineNode(tpl, item, index) {
    var html = tpl.innerHTML;
    if (!html) return null;

    var qty = item.quantity || 1;
    // Variant title is null for default-variant products (matches the Liquid
    // `has_only_default_variant` suppression).
    var variantTitle = item.variant_title || "";
    var image = item.image || (item.featured_image && item.featured_image.url) || "";
    var plan =
      (item.selling_plan_allocation &&
        item.selling_plan_allocation.selling_plan &&
        item.selling_plan_allocation.selling_plan.name) ||
      "";
    var variantId =
      item.variant_id != null ? item.variant_id : item.id != null ? item.id : "";
    var planId =
      (item.selling_plan_allocation &&
        item.selling_plan_allocation.selling_plan &&
        item.selling_plan_allocation.selling_plan.id) ||
      "";

    var repl = {
      __DM_L_KEY__: esc(item.key || ""),
      __DM_L_VARIANT_ID__: esc(variantId),
      __DM_L_SELLING_PLAN__: esc(planId),
      __DM_L_BAR_ID__: esc((item.properties && item.properties._bar_id) || ""),
      __DM_L_INDEX__: String(index),
      __DM_L_TITLE__: esc(item.product_title || item.title || ""),
      __DM_L_VARIANT__: variantTitle ? esc(variantTitle) : "",
      __DM_L_QTY__: String(qty),
      // Prices/discounts: blank until the reconcile (see note above).
      __DM_L_UNIT__: "",
      __DM_L_LINE__: "",
      __DM_L_ORIG_LINE__: "",
      __DM_L_COMPARE__: "",
      __DM_L_DISCOUNT__: "",
      __DM_L_DISCOUNT_PCT__: "",
      __DM_L_DISCOUNT_TITLE__: "",
      __DM_L_PLAN__: esc(plan),
      __DM_L_IMAGE__: esc(image),
    };
    for (var token in repl) html = html.split(token).join(repl[token]);

    var holder = document.createElement("template");
    holder.innerHTML = html;
    return holder.content.firstElementChild;
  }

  // Render the added items instantly + open. Returns true if it handled the add
  // (caller then reconciles in place); false → caller falls back to a refresh.
  function optimisticAdd(data) {
    var drawer = getDrawer();
    if (!drawer) return false;
    var items = data && data.items ? data.items : data && data.id ? [data] : null;
    if (!items || !items.length) return false;

    var cartItems = drawer.querySelector('[data-atom-type="cart-items"]');
    var tpl = drawer.querySelector("template[data-cart-line-template]");
    if (!cartItems || !tpl) return false;

    var baseIndex = cartItems.querySelectorAll("[data-cart-items-line]").length;
    var delta = 0;
    var rendered = 0;

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var existing = findLine(cartItems, item);
      var newQty = item.quantity || 1;
      if (existing) {
        // Re-adding a variant already in the cart → Shopify merged it into the
        // existing line. Leave that line UNTOUCHED: bumping its qty text now,
        // while its line-total still shows the old amount, would read as a wrong
        // price for ~150ms. The reconcile updates qty AND price together. We
        // still move the header count bubble (a count is unambiguous, never a
        // wrong price) and count it as rendered so we open + reconcile.
        var qtyEl = existing.querySelector('[data-bind="line.quantity"]');
        var prevQty = qtyEl ? parseInt(qtyEl.textContent, 10) || 0 : 0;
        delta += newQty - prevQty;
        rendered++;
      } else {
        var node = buildLineNode(tpl, item, baseIndex + rendered + 1);
        if (node) {
          // Before the inert template when it's a direct child; else just append
          // (the template is display:none, so trailing position is harmless).
          if (tpl.parentNode === cartItems) cartItems.insertBefore(node, tpl);
          else cartItems.appendChild(node);
          delta += newQty;
          rendered++;
        }
      }
    }

    if (!rendered) return false;

    // Flip the body toggle to filled (applyPanel re-syncs from the reconcile).
    drawer.setAttribute("data-cart-empty", "false");
    // Move the header count bubble by the optimistic delta now; refreshCartCount
    // (already fired by the intercept) reconciles it authoritatively.
    var cur = currentCount();
    if (cur != null && delta) syncCartCount(cur + delta);
    openCart();
    return true;
  }

  // Pre-optimistic-add behavior — used when we can't render optimistically
  // (no template/body, or the response wasn't parseable): refresh first, then
  // open already-filled (closed) or reconcile in place (open).
  function addFallback() {
    if (isDrawerOpen()) refreshDrawer();
    else refreshDrawer(openCart);
  }

  // ── Delegated clicks (cart trigger + line controls) ────────────────────────
  // Common header cart-trigger selectors across themes — best-effort. Adding a
  // theme's own selector here is the single per-theme tweak the drawer needs.
  var TRIGGER_SELECTOR = [
    "[data-dm-cart-trigger]",
    'a[href$="/cart"]',
    'a[href*="/cart?"]',
    "#cart-icon-bubble",
    ".cart-link",
    "[data-cart-icon]",
  ].join(",");

  var ACTION_SELECTOR =
    '[data-button-action="cart-increase"],' +
    '[data-button-action="cart-decrease"],' +
    '[data-button-action="cart-remove"]';

  document.addEventListener(
    "click",
    function (e) {
      if (inEditor()) return;
      var t = e.target;
      if (!t || !t.closest) return;

      // 1. Line −/+/remove (check first — these live inside the drawer).
      var actionBtn = t.closest(ACTION_SELECTOR);
      if (actionBtn && getDrawer() && getDrawer().contains(actionBtn)) {
        e.preventDefault();
        var line = actionBtn.closest("[data-cart-line-key]");
        if (!line) return;
        var key = line.getAttribute("data-cart-line-key");
        var action = actionBtn.getAttribute("data-button-action");
        // A bundle-tier line is ATOMIC: the discount Function prices exactly the
        // tier's own quantity off `_bar_id`, so any other quantity mis-prices —
        // Shopify splits the surplus into a second, undiscounted line, which
        // reads in the drawer as a duplicate product appearing out of nowhere
        // (a 3-pack at 19.95 stepped to qty 4 becomes 19.95 + a bare 9.95 line).
        // Stepping has no correct destination, so only remove acts here; the
        // shopper changes tier on the product page. dm-theme.css hides the
        // −/+ on these lines, so this is the guard for a stale theme copy.
        if (
          action !== "cart-remove" &&
          (line.getAttribute("data-cart-line-bundle-tier") || "") !== ""
        ) {
          return;
        }
        // Read the INTENDED qty, not just the displayed one. Under "hold until
        // reconcile" the visible qty doesn't move on click, so a rapid second
        // click would otherwise re-read the same stale number and POST the wrong
        // target. `data-pending-qty` carries the in-flight target between clicks;
        // the reconcile wipes it (applyPanel replaces the line markup), so it
        // auto-resets to the live qty afterwards.
        var qtyEl = line.querySelector('[data-bind="line.quantity"]');
        var pending = line.getAttribute("data-pending-qty");
        var current =
          pending != null
            ? parseInt(pending, 10) || 0
            : qtyEl
            ? parseInt(qtyEl.textContent, 10) || 1
            : 1;
        var next =
          action === "cart-remove"
            ? 0
            : action === "cart-increase"
            ? current + 1
            : Math.max(0, current - 1);
        if (next === current) return;
        // Hold until reconcile — do NOT mutate the line's qty / price / presence
        // optimistically. A new qty against an unchanged line total (or a removed
        // line against an unchanged subtotal) reads as a wrong price for ~150ms
        // (founder rule: never show a wrong price). changeLine() re-renders the
        // line — qty AND price — together, and applyPanel re-syncs the empty body
        // if this emptied the cart. We only move the header count bubble (a count
        // is never a wrong price) so the click still registers; stash the target
        // for rapid clicks.
        line.setAttribute("data-pending-qty", String(next));
        var cur = currentCount();
        if (cur != null) syncCartCount(cur + (next - current));
        changeLine(key, next);
        return;
      }

      // 2. Theme cart trigger → open the drawer instead of navigating. Only
      //    when a drawer exists; otherwise let the theme handle it.
      var trigger = t.closest(TRIGGER_SELECTOR);
      if (trigger && getDrawer()) {
        e.preventDefault();
        openCart();
      }
    },
    // Capture phase so we beat the theme's own cart-drawer / navigation handler.
    true
  );

  // ── Cart-mutation interception (refresh + open-on-add) ─────────────────────
  // Patch window.fetch so ANY script's AJAX cart write refreshes the drawer
  // (the theme's native ATC, dm-dropmagic.js's ATC, etc.). Our own calls use
  // origFetch, so they never reach here.
  function isCartWrite(url) {
    return (
      url.indexOf("/cart/add") !== -1 ||
      url.indexOf("/cart/change") !== -1 ||
      url.indexOf("/cart/update") !== -1 ||
      url.indexOf("/cart/clear") !== -1
    );
  }

  window.fetch = function (input, init) {
    var url =
      typeof input === "string"
        ? input
        : (input && input.url) || "";
    var promise = origFetch(input, init);
    if (url && isCartWrite(url) && getDrawer() && !inEditor()) {
      promise
        .then(function (res) {
          if (!res || !res.ok) return;
          // Keep the header count bubble live for this mutation regardless of
          // who made it (/cart/add returns only the line, so read /cart.js).
          refreshCartCount();
          if (url.indexOf("/cart/add") !== -1) {
            // Optimistic add — render the new line(s) from the response + open
            // INSTANTLY (no round-trip), then reconcile in place. clone() so we
            // never disturb the original caller's res.json() (dm-dropmagic.js's
            // ATC or the theme's native add). The intercept's .then runs before
            // the caller's (registered first), so the body is still unread here.
            var clone = null;
            try {
              clone = res.clone();
            } catch (e) {
              clone = null;
            }
            if (clone) {
              clone
                .json()
                .then(function (data) {
                  if (optimisticAdd(data)) refreshDrawer();
                  else addFallback();
                })
                .catch(addFallback);
            } else {
              addFallback();
            }
          } else {
            // Any other cart mutation (theme native change elsewhere) — keep the
            // drawer's content current for the next open.
            refreshDrawer();
          }
        })
        .catch(function () {
          /* network error on someone else's request — not ours to surface */
        });
    }
    return promise;
  };
})();
