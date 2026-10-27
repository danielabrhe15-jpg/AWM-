/**
 * dm-list.js — `<dm-list>` custom element. Storefront-only today
 * (the editor has its own React-driven layout switching via
 * `useCanvasBreakpoint`); the script consumes the same `data-*`
 * attribute contract on both sides.
 *
 * Per-instance state machine:
 *   - On connect, read the viewport. If `desktopLayout/mobileLayout`
 *     calls for carousel at the current width (or `bind=product.media`
 *     forces it), build the Swiper DOM around the SSR'd children. If
 *     not, leave the SSR'd CSS-grid alone.
 *   - On window resize (150ms debounce), re-check. Cross the 768px
 *     threshold the wrong way → tear down Swiper + restore the flat
 *     child order. Cross back → re-init.
 *   - On disconnect, destroy Swiper + leave the registry.
 *
 * Single window-resize listener is attached once at module scope; every
 * instance registers itself in `instances` on connect and removes itself
 * on disconnect. Keeps listener count bounded regardless of page churn.
 *
 * Swiper is loaded in `sections/dm-page.liquid` before this script
 * (thanks to `defer` ordering), so `window.Swiper` is available by
 * connect time.
 */
(function () {
  if (window.__dmListInit) return;
  window.__dmListInit = true;

  var BREAKPOINT = 768;
  var spaceBetweenMap = { none: 0, xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };
  // Small fixed leading inset (px, ≈ `--dm-space-2`) for full-width LOOP
  // carousels — a peek before the first slide. Loop gets `slidesOffsetBefore`
  // only, never `slidesOffsetAfter` (the trailing offset broke the wrap).
  // Mirror: FULL_WIDTH_LOOP_LEAD_INSET in carousel-layout.tsx.
  var FULL_WIDTH_LOOP_LEAD_INSET = 8;

  // Full-width carousels bleed the `.swiper` viewport to both window edges
  // (dm-theme.css). The gutter offset keeps the first/last slide aligned to the
  // section content edge — measured off the still-bounded host (`<dm-list>`)
  // vs. the full-width `.swiper`. Mirror: computeBleedOffsets in
  // carousel-layout.tsx. Re-run on resize (the host caps at the section
  // max-width, so the gutter can change while the host doesn't).
  function bleedOffsets(hostEl, swiperEl) {
    if (!hostEl || !swiperEl) return { before: 0, after: 0 };
    var h = hostEl.getBoundingClientRect();
    var s = swiperEl.getBoundingClientRect();
    return {
      before: Math.max(0, Math.round(h.left - s.left)),
      after: Math.max(0, Math.round(s.right - h.right)),
    };
  }

  // Mirrors STACKED_VARIANTS / STYLE_FORCES in carousel-layout.tsx.
  // To tweak a preset (or add a style), edit both files in lockstep.
  var STACKED_VARIANTS = {
    subtle: { scale: 0.92, offsetX: "85%", depth: 2, opacity: 1.0 },
    default: { scale: 0.85, offsetX: "78%", depth: 3, opacity: 0.9 },
    dramatic: { scale: 0.7, offsetX: "70%", depth: 4, opacity: 0.7 },
  };
  var STYLE_FORCES = {
    slide: {},
    stacked: { centered: true },
    coverflow: { centered: true },
  };

  // Registry — instances push themselves on connect, splice on disconnect.
  // One shared resize listener iterates this list and calls each
  // instance's `_dmCheckViewport()`.
  var instances = [];
  var resizeTimer = 0;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      for (var i = 0; i < instances.length; i++) {
        instances[i]._dmCheckViewport();
      }
    }, 150);
  });

  class DmList extends HTMLElement {
    connectedCallback() {
      if (this.dataset.dmInit) return;

      var el = this;
      var desktopLayout = el.getAttribute("data-list-desktop") || "group";
      var mobileLayout = el.getAttribute("data-list-mobile") || "carousel";

      // Skip when NEITHER viewport needs a carousel — pure grid/group is
      // driven by CSS alone. This now includes product-media-bound lists in
      // group mode: the binding decides where the slides come from (Liquid
      // already looped `p.media` into one item per media at SSR), not how
      // they're laid out, so a group-mode media list is a plain CSS grid and
      // never touches Swiper. Mirrors `activeLayout` in list/render.tsx.
      if (desktopLayout !== "carousel" && mobileLayout !== "carousel") {
        return;
      }

      el.dataset.dmInit = "1";

      var slidesPerView =
        parseFloat(el.getAttribute("data-carousel-slides-per-view")) || 3;
      var slidesPerViewSm =
        parseFloat(el.getAttribute("data-carousel-slides-per-view-sm")) || 1;
      var spaceBetween =
        spaceBetweenMap[el.getAttribute("data-list-gap")] || 16;
      var speed = parseInt(el.getAttribute("data-carousel-speed")) || 300;
      // Playback is a 3-state (none / loop / rewind). Legacy back-compat:
      // "true" -> loop, "false"/absent -> none. `rewind` is never combined
      // with `loop` (Swiper requirement). Mirror: carousel-layout.tsx.
      var playback = el.getAttribute("data-carousel-loop");
      var loop = playback === "loop" || playback === "true";
      var rewind = playback === "rewind";
      var autoplay = el.getAttribute("data-carousel-autoplay") === "true";
      var autoplayDelay =
        parseInt(el.getAttribute("data-carousel-autoplay-delay")) || 3000;
      var pauseOnHover =
        el.getAttribute("data-carousel-pause-on-hover") !== "false";
      var isFullWidth = el.getAttribute("data-list-width") === "full";
      // Non-loop full-width → measured gutter offsets (re-synced on resize).
      // Loop full-width → a small FIXED leading inset only (peek before slide 1;
      // no trailing offset — that broke the loop wrap). Mirror:
      // useMeasuredOffsets in carousel-layout.tsx.
      var useMeasuredOffsets = isFullWidth && !loop;

      var carouselStyle = el.getAttribute("data-carousel-style") || "slide";
      if (!STYLE_FORCES[carouselStyle]) carouselStyle = "slide";
      var stackedVariant =
        el.getAttribute("data-carousel-stacked-variant") || "default";
      if (!STACKED_VARIANTS[stackedVariant]) stackedVariant = "default";

      // Direction (responsive). Swiper can't change `direction` per-breakpoint
      // (init-only param), so pick the effective axis at init based on the
      // current viewport. Threshold matches the CSS @media block (max-width
      // 768px) so the JS-driven axis and the CSS layout flip at the same
      // viewport. No viewport-switch re-init on resize — most merchants pick
      // one direction for both viewports; cross-breakpoint changes don't
      // auto-flip without a page reload.
      var directionDesktop =
        el.getAttribute("data-carousel-direction") || "horizontal";
      if (directionDesktop !== "vertical") directionDesktop = "horizontal";
      var directionSm = el.getAttribute("data-carousel-direction-sm") || "";
      if (directionSm !== "horizontal" && directionSm !== "vertical")
        directionSm = "";
      var directionMobile = directionSm || directionDesktop;
      var isMobileViewport =
        typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(max-width: 768px)").matches;
      var effectiveDirection = isMobileViewport
        ? directionMobile
        : directionDesktop;
      // Vertical axis force-coerces style to `slide` — Stacked/Coverflow
      // geometry assumes horizontal axis. Mirror of carousel-layout.tsx.
      if (effectiveDirection === "vertical") {
        carouselStyle = "slide";
      }

      // Thumbnails — derived chrome (mirror: carousel-layout.tsx). The strip
      // is built at init by CLONING the slide DOM (never authored content),
      // and linked to the main instance via Swiper's Thumbs module. Show +
      // position resolve per viewport at init, like `direction` (the strip's
      // Swiper axis is init-only; no re-init on viewport cross).
      var thumbsShowDesktop = el.getAttribute("data-thumbs-show") === "true";
      var thumbsShowSm = el.getAttribute("data-thumbs-show-sm");
      var effThumbsShow = isMobileViewport
        ? thumbsShowSm != null
          ? thumbsShowSm === "true"
          : thumbsShowDesktop
        : thumbsShowDesktop;
      var isSidePos = function (v) {
        return v === "left" || v === "right";
      };
      var thumbsPosSm = el.getAttribute("data-thumbs-position-sm");
      var effThumbsPosRaw =
        isMobileViewport && thumbsPosSm
          ? thumbsPosSm
          : el.getAttribute("data-thumbs-position");
      var effThumbsPos = isSidePos(effThumbsPosRaw) ? effThumbsPosRaw : "under";

      var styleForces = STYLE_FORCES[carouselStyle];
      var effSlidesPerView =
        styleForces.slidesPerView != null
          ? styleForces.slidesPerView
          : slidesPerView;
      var effSlidesPerViewSm =
        styleForces.slidesPerViewMobile != null
          ? styleForces.slidesPerViewMobile
          : slidesPerViewSm;
      // Vertical axis → content-driven slide heights (slidesPerView "auto").
      // A computed per-slide height pins both axes of the slide child and
      // silently defeats a Media's aspect-ratio (1:1 thumbs render
      // off-square). dm-theme.css releases the `height: 100%` child pin for
      // vertical hosts; the merchant slidesPerView knob is horizontal-only.
      // Direction is init-effective (no re-init on viewport cross — see the
      // direction block above), so coerce both breakpoint values together.
      // Mirror: carousel-layout.tsx.
      if (effectiveDirection === "vertical") {
        effSlidesPerView = "auto";
        effSlidesPerViewSm = "auto";
      }
      // Centering is style-driven only (stacked/coverflow force it) — there
      // is no merchant-facing `centered` setting. Mirror: carousel-layout.tsx.
      var effCentered = styleForces.centered != null ? styleForces.centered : false;
      var effSpaceBetween =
        styleForces.spaceBetween != null
          ? styleForces.spaceBetween
          : spaceBetween;

      var effectConfig = {};
      if (carouselStyle === "stacked") {
        var v = STACKED_VARIANTS[stackedVariant];
        effectConfig.effect = "creative";
        effectConfig.creativeEffect = {
          limitProgress: v.depth,
          prev: {
            translate: ["-" + v.offsetX, 0, 0],
            scale: v.scale,
            opacity: v.opacity,
          },
          next: {
            translate: [v.offsetX, 0, 0],
            scale: v.scale,
            opacity: v.opacity,
          },
        };
      } else if (carouselStyle === "coverflow") {
        effectConfig.effect = "coverflow";
        effectConfig.coverflowEffect = {
          rotate: 25,
          depth: 100,
          stretch: 0,
          slideShadows: false,
        };
      }

      var sw = null;
      var isCarousel = false;
      // The `.swiper` viewport element (built in initCarousel). Held at this
      // scope so the resize path can re-measure the full-width gutter offset.
      var swiperEl = null;
      // Thumbnail strip (built in initCarousel when data-thumbs-show).
      var thumbsSw = null;
      var thumbsStripDiv = null;

      // Chrome (`.dm-arrow-group`, `.swiper-pagination`) is SSR'd by
      // dm-list.liquid so we don't have to string-surgery the arrow SVG
      // at runtime. Capture refs here and split chrome OUT of
      // `originalChildren` — only real slide hosts get wrapped/wrapped-
      // back on init/destroy.
      var arrowGroup = el.querySelector(":scope > .dm-arrow-group");
      var prevBtn = arrowGroup
        ? arrowGroup.querySelector(".swiper-button-prev")
        : null;
      var nextBtn = arrowGroup
        ? arrowGroup.querySelector(".swiper-button-next")
        : null;

      // Both arrows are SSR'd by dm-list.liquid (two `content_for 'block'`
      // calls), so no runtime cloning is needed here. Prev's child is
      // flipped horizontally by a dm-theme.css rule
      // (`.dm-arrow-group .swiper-button-prev > *`), shared with the
      // React render path in carousel-layout.tsx.
      //
      // Arrow Buttons publish as `<a href="#">` — cancel the hash-jump so a
      // click only drives Swiper's navigation, not a scroll-to-top.
      if (arrowGroup) {
        arrowGroup.addEventListener("click", function (e) {
          e.preventDefault();
        });
      }

      // Pagination is SSR'd either as a direct-child sibling (independent
      // dots) OR nested inside `.dm-arrow-group` when arrows + dots co-locate
      // at the same corner (dm-list.liquid `co_located`). Find it either way
      // and remember which shape it is — a `:scope >` query alone misses the
      // nested case and Swiper would bind bullets to a stray element, leaving
      // the co-located dots empty. Mirror: carousel-layout.tsx `coLocated`.
      var coLocatedPag = arrowGroup
        ? arrowGroup.querySelector(":scope > .swiper-pagination")
        : null;
      var pagEl = coLocatedPag || el.querySelector(":scope > .swiper-pagination");
      var isPagCoLocated = !!coLocatedPag;
      var originalChildren = Array.from(el.children).filter(function (c) {
        return c !== arrowGroup && c !== pagEl;
      });

      function initCarousel() {
        if (isCarousel) return;
        isCarousel = true;
        el.setAttribute("data-list-layout", "carousel");

        // Inner track wrapper — mirrors React's `.dm-carousel-track`.
        // Horizontal: relative + 100% width — content drives natural height.
        // Vertical: absolute fill — host contributes 0 to flex-row natural
        // height so a sibling (main carousel in thumb-strip pattern)
        // determines the row height. Mirror: carousel-layout.tsx.
        var isVerticalEff = effectiveDirection === "vertical";
        var trackDiv = document.createElement("div");
        trackDiv.className = "dm-carousel-track";
        if (isVerticalEff) {
          trackDiv.style.position = "absolute";
          trackDiv.style.inset = "0";
        } else {
          trackDiv.style.position = "relative";
          trackDiv.style.width = "100%";
        }

        var swiperDiv = document.createElement("div");
        swiperEl = swiperDiv;
        swiperDiv.className = "swiper";
        swiperDiv.style.width = "100%";
        if (isVerticalEff) swiperDiv.style.height = "100%";
        // Match React's overflow rules — clip BOTH axes so off-screen
        // slides don't cause page scroll. `overflowClipMargin` only takes
        // effect when both axes are `clip`; a `clip` + `visible` mix makes
        // the browser drop the margin and clip flush, shaving edge slides'
        // 1px card ring. The 4px margin lets rings render just outside the
        // clip without bleeding into siblings. Mirror: CarouselLayout (React).
        swiperDiv.style.overflowX = "clip";
        swiperDiv.style.overflowY = "clip";
        swiperDiv.style.overflowClipMargin = "4px";

        var wrapperDiv = document.createElement("div");
        wrapperDiv.className = "swiper-wrapper";

        originalChildren.forEach(function (child) {
          var slide;
          if (child.classList && child.classList.contains("swiper-slide")) {
            slide = child;
          } else if (
            child.hasAttribute &&
            child.hasAttribute("data-slide-media-id")
          ) {
            // A product-media item SSR'd for the GROUP layout (this list is
            // `desktopLayout: group` + `mobileLayout: carousel`, or the other
            // way round). Promote it to a slide IN PLACE rather than wrapping
            // it: the sync listeners in dm-dropmagic.js read
            // `data-slide-media-id` / `data-slide-variant-id` off the
            // `.swiper-slide` element itself, and wrapping would bury those
            // ids one level down — variant sync would silently stop matching.
            child.classList.remove("dm-media-item");
            child.classList.add("swiper-slide");
            slide = child;
          } else {
            slide = document.createElement("div");
            slide.className = "swiper-slide";
            slide.appendChild(child);
          }
          wrapperDiv.appendChild(slide);
        });

        swiperDiv.appendChild(wrapperDiv);
        el.innerHTML = "";
        trackDiv.appendChild(swiperDiv);
        el.appendChild(trackDiv);

        if (!arrowGroup) {
          arrowGroup = document.createElement("div");
          arrowGroup.className = "dm-arrow-group";
          prevBtn = document.createElement("div");
          prevBtn.className = "swiper-button-prev";
          nextBtn = document.createElement("div");
          nextBtn.className = "swiper-button-next";
          arrowGroup.appendChild(prevBtn);
          arrowGroup.appendChild(nextBtn);
        }
        trackDiv.appendChild(arrowGroup);

        if (!pagEl) {
          pagEl = document.createElement("div");
          pagEl.className = "swiper-pagination";
        }
        // Independent dots: append as a direct child of the track (corner
        // positioning is CSS-driven off `data-dots-position`). Co-located
        // dots already live inside `arrowGroup` (appended just above), so
        // appending here would yank them back out and break the flex row.
        if (!isPagCoLocated) {
          trackDiv.appendChild(pagEl);
        }

        // Thumbnail strip — derived chrome: clone each slide's DOM into a
        // square thumb (never authored content — the strip can't diverge
        // from the carousel), append after the track, init as a plain
        // Swiper, and hand it to the main instance via the Thumbs module
        // below. Mirror: the strip render + init in carousel-layout.tsx.
        if (effThumbsShow) {
          thumbsStripDiv = document.createElement("div");
          thumbsStripDiv.className = "dm-thumbs";
          var thumbsSwiperDiv = document.createElement("div");
          thumbsSwiperDiv.className = "swiper";
          var thumbsWrapperDiv = document.createElement("div");
          thumbsWrapperDiv.className = "swiper-wrapper";
          for (var si = 0; si < wrapperDiv.children.length; si++) {
            var tSlide = document.createElement("div");
            tSlide.className = "swiper-slide";
            var clone = wrapperDiv.children[si].cloneNode(true);
            clone.classList.remove(
              "swiper-slide",
              "dm-media-item",
              "swiper-slide-active",
              "swiper-slide-next",
              "swiper-slide-prev",
            );
            clone.removeAttribute("data-swiper-slide-index");
            tSlide.appendChild(clone);
            thumbsWrapperDiv.appendChild(tSlide);
          }
          thumbsSwiperDiv.appendChild(thumbsWrapperDiv);
          thumbsStripDiv.appendChild(thumbsSwiperDiv);
          el.appendChild(thumbsStripDiv);
          try {
            thumbsSw = new Swiper(thumbsSwiperDiv, {
              direction: effThumbsPos === "under" ? "horizontal" : "vertical",
              slidesPerView: "auto",
              spaceBetween: 8,
              // Mirrors carousel-layout.tsx — see the note there. Centres the
              // strip only while it under-fills the track; inert once the
              // thumbs overflow and scroll. Horizontal strip only.
              centerInsufficientSlides: effThumbsPos === "under",
              watchOverflow: true,
              watchSlidesProgress: true,
              slideToClickedSlide: false,
              observer: true,
              observeParents: true,
            });
          } catch (e2) {
            console.warn("[dm-list] thumbs Swiper init error:", e2);
          }
        }

        // Non-loop full-width → measured gutter (now that the `.swiper` is in
        // the DOM with the CSS bleed applied). Loop full-width → fixed leading
        // peek. Contained → no offset.
        var offsets = useMeasuredOffsets
          ? bleedOffsets(el, swiperDiv)
          : isFullWidth && loop
            ? { before: FULL_WIDTH_LOOP_LEAD_INSET, after: 0 }
            : { before: 0, after: 0 };

        try {
          sw = new Swiper(
            swiperDiv,
            Object.assign(
              {},
              effectConfig,
              // Link the derived strip (built above) — the Thumbs module owns
              // click-to-navigate, follow-on-change and the active class.
              thumbsSw ? { thumbs: { swiper: thumbsSw } } : {},
              {
              // Mobile-first: base = mobile, `breakpoints` switches to the
              // desktop count at 768px of VIEWPORT width — same threshold as
              // the CSS @media block and the layout flip above, so every
              // responsive knob (layout, direction, chrome, slide count) flips
              // together. NOT container-based: a carousel in a sub-768px
              // column (any 2-column section) must still show the desktop
              // count on desktop. Builder mirror: carousel-layout.tsx (picks
              // the effective count per canvas breakpoint in React).
              slidesPerView: effSlidesPerViewSm,
              spaceBetween: effSpaceBetween,
              speed: speed,
              slidesOffsetBefore: offsets.before,
              slidesOffsetAfter: offsets.after,
              grabCursor: true,
              loop: loop,
              rewind: rewind,
              // loop + centered needs clones on both flanks; pad the budget so
              // the centered active slide isn't left with a blank gap. Mirror:
              // carousel-layout.tsx.
              loopAdditionalSlides:
                loop && effCentered
                  ? Math.ceil(Math.max(effSlidesPerView, effSlidesPerViewSm))
                  : 0,
              centeredSlides: effCentered,
              direction: effectiveDirection,
              breakpointsBase: "window",
              breakpoints: {
                768: { slidesPerView: effSlidesPerView },
              },
              // Swiper's default (true) silently swallows slideNext() while
              // `animating` is set, and `animating` only clears on the
              // wrapper's transitionend — one missed/cancelled transition
              // and the loop seam goes dead. Mirror: carousel-layout.tsx.
              loopPreventsSliding: false,
              slideToClickedSlide: true,
              navigation: { nextEl: nextBtn, prevEl: prevBtn },
              pagination: {
                el: pagEl,
                clickable: true,
                // Always bullets — variant shape (fluid pill, backdrop frost,
                // etc.) is CSS-driven via `[data-dots-style='…']`.
                type: "bullets",
              },
              autoplay: autoplay
                ? {
                    delay: autoplayDelay,
                    disableOnInteraction: false,
                    pauseOnMouseEnter: pauseOnHover,
                  }
                : false,
              preventInteractionOnTransition: false,
              watchOverflow: false,
              observer: true,
              observeParents: true,
            }),
          );
        } catch (e) {
          console.warn("[dm-list] Swiper init error:", e);
        }

        if (sw) {
          el.__dmSwiper = sw;
          var productId = el.dataset.dmProductId || null;
          if (
            productId &&
            el.getAttribute("data-list-sync-siblings") === "true"
          ) {
            sw.on("slideChange", function () {
              if (sw.__dmProgrammatic) return;
              var idx = sw.realIndex;
              // Resolve by data-swiper-slide-index (the original index
              // Swiper stamps in loop mode) — v12 loopFix ROTATES the real
              // slide DOM (no `.swiper-slide-duplicate` clones since v9),
              // so a positional lookup emits the WRONG slide's ids after
              // the first wrap. Positional fallback covers non-loop (no
              // attribute, DOM never moves). Scoped to the MAIN .swiper —
              // the host may also hold the derived thumb strip, whose
              // slides duplicate these attrs. Mirror: carousel-layout.tsx.
              var scopeRoot = sw.el || el;
              var active = scopeRoot.querySelector(
                '.swiper-slide[data-swiper-slide-index="' + idx + '"]',
              );
              if (!active) {
                active = scopeRoot.querySelectorAll(".swiper-slide")[idx];
              }
              var vAttr = active
                ? active.getAttribute("data-slide-variant-id")
                : null;
              var firstV = vAttr ? vAttr.split(",")[0] : null;
              var mediaAttr = active
                ? active.getAttribute("data-slide-media-id")
                : null;
              if (window.dropmagic) {
                window.dropmagic.emit("dm:carousel-slide-changed", {
                  productId: productId,
                  slideIndex: idx,
                  variantId: firstV ? Number(firstV) : null,
                  mediaId: mediaAttr ? Number(mediaAttr) : null,
                });
              }
            });
          }
        }
      }

      // Demote a product-media item back to a grid item — the mirror of
      // initCarousel's in-place promotion. `.swiper-slide` carries an unscoped
      // `width/height: 100%` from swiper-bundle.css, which would leak into the
      // CSS grid if left on. No-op for non-bound children.
      function demoteMediaItem(child) {
        if (
          child.classList &&
          child.hasAttribute &&
          child.hasAttribute("data-slide-media-id")
        ) {
          child.classList.remove("swiper-slide");
          child.classList.add("dm-media-item");
        }
      }

      function destroyCarousel() {
        // Claim group layout FIRST, before the `isCarousel` guard. A list can
        // want group on THIS viewport while having SSR'd as carousel
        // (`initial_layout` = desktop_layout, so a `desktop: carousel` +
        // `mobile: group` list lands on a phone marked carousel, with its media
        // items already `.swiper-slide`-classed) — Swiper was never inited, but
        // the attr and the classes still have to say group or the CSS grid
        // never takes and swiper-bundle's slide sizing leaks in.
        el.setAttribute("data-list-layout", "group");

        if (!isCarousel) {
          // Never inited: the DOM is still the flat SSR shape (Liquid emits the
          // slides as direct children — the `.swiper` track is built by
          // initCarousel), so only the classes need fixing.
          originalChildren.forEach(demoteMediaItem);
          return;
        }
        isCarousel = false;

        if (sw) {
          sw.destroy(true, true);
          sw = null;
        }
        // Strip teardown — we created the instance (not the Thumbs module),
        // so we destroy it; the DOM is runtime-built chrome, safe to drop.
        if (thumbsSw) {
          try {
            thumbsSw.destroy(true, true);
          } catch (e3) {
            /* already destroyed */
          }
          thumbsSw = null;
        }
        if (thumbsStripDiv && thumbsStripDiv.parentNode) {
          thumbsStripDiv.parentNode.removeChild(thumbsStripDiv);
        }
        thumbsStripDiv = null;
        delete el.__dmSwiper;

        // Restore: children flat, with chrome appended back as siblings
        // (so a subsequent re-init can pick them up via the same scoped
        // queries). Mirrors the SSR DOM shape from dm-list.liquid.
        el.innerHTML = "";
        originalChildren.forEach(function (child) {
          demoteMediaItem(child);
          el.appendChild(child);
        });
        if (arrowGroup) el.appendChild(arrowGroup);
        // Co-located pagination rides inside `arrowGroup` (re-appended above) —
        // appending it here would detach it back to a bare sibling and lose
        // the co-located shape on a subsequent re-init.
        if (pagEl && !isPagCoLocated) el.appendChild(pagEl);
      }

      // Per-instance check used by the shared window resize listener.
      el._dmCheckViewport = function () {
        var isMobile = window.innerWidth <= BREAKPOINT;
        var activeLayout = isMobile ? mobileLayout : desktopLayout;
        if (activeLayout === "carousel") {
          initCarousel();
          // Re-sync the full-width gutter offset on every resize — the host
          // caps at the section max-width, so the gutter can change even when
          // the carousel stays mounted. Mirror: the ResizeObserver in
          // carousel-layout.tsx.
          if (useMeasuredOffsets && sw && swiperEl) {
            var off = bleedOffsets(el, swiperEl);
            sw.params.slidesOffsetBefore = off.before;
            sw.params.slidesOffsetAfter = off.after;
            sw.update();
          }
        } else {
          destroyCarousel();
        }
      };

      // Expose destroy for cleanup on disconnect — closure-bound to
      // this instance's `sw` reference.
      el._dmDestroyCarousel = destroyCarousel;

      instances.push(el);
      el._dmCheckViewport();
    }

    disconnectedCallback() {
      // Best-effort Swiper teardown + restore flat DOM, in case the
      // host element returns to the DOM later (rare; ResizeObserver in
      // editor preview can re-attach the same iframe).
      if (this._dmDestroyCarousel) {
        try {
          this._dmDestroyCarousel();
        } catch (e) {
          /* swallow — element is leaving anyway */
        }
      }
      var idx = instances.indexOf(this);
      if (idx !== -1) instances.splice(idx, 1);
    }
  }

  customElements.define("dm-list", DmList);
})();
