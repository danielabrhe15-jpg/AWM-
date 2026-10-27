/**
 * DropMagic Carousel — `<dm-carousel>` custom element. Single source of
 * truth for both surfaces (storefront `<script src>` + editor `?raw`
 * import — see `src/components/builder/AGENTS.md` "Atom interactivity").
 *
 * Wraps existing `.swiper-slide` children in `.swiper > .swiper-wrapper`,
 * appends navigation + pagination chrome as direct children of
 * `<dm-carousel>` (sitting in its padding area, outside the slide
 * overflow:hidden region), and initializes vanilla Swiper.
 *
 * Liquid emits each Slide as `<div class="swiper-slide dm-slide" data-slide-*>`.
 * The React render does the same. The DOM-rewrite step here is what makes
 * the same set of slide markup work in both contexts.
 *
 * Swiper is loaded in `dm-page.liquid` before this script (thanks to
 * `defer` ordering), so `Swiper` is available by connect time.
 */
(function () {
  if (window.__dmCarouselInit) return;
  window.__dmCarouselInit = true;

  class DmCarousel extends HTMLElement {
    connectedCallback() {
      if (this.dataset.dmInit) return;
      this.dataset.dmInit = "1";

      var el = this;

      // ----- Read config from data attributes -----
      var slidesPerView =
        parseInt(el.getAttribute("data-carousel-slides-per-view")) || 1;
      var spaceBetweenMap = { none: 0, sm: 8, md: 16, lg: 24 };
      var spaceBetween =
        spaceBetweenMap[el.getAttribute("data-carousel-space-between")] || 16;
      var loop = el.getAttribute("data-carousel-loop") === "true";
      var autoplay = el.getAttribute("data-carousel-autoplay") === "true";
      var autoplayDelay =
        parseInt(el.getAttribute("data-carousel-autoplay-delay")) || 5000;
      var speed = parseInt(el.getAttribute("data-carousel-speed")) || 300;
      var effect = el.getAttribute("data-carousel-effect") || "slide";
      var centered = el.getAttribute("data-carousel-centered") === "true";
      var direction =
        el.getAttribute("data-carousel-direction") || "horizontal";
      var pauseOnHover =
        el.getAttribute("data-carousel-pause-on-hover") !== "false";
      var navigation =
        el.getAttribute("data-carousel-navigation") !== "false";
      var pagination = el.getAttribute("data-carousel-pagination") || "dots";
      var smSlidesPerView =
        parseInt(el.getAttribute("data-carousel-slides-per-view-sm")) ||
        slidesPerView;

      // ----- Collect existing slide elements -----
      var slideElements = Array.from(el.querySelectorAll(".swiper-slide"));
      if (!slideElements.length) return;

      // ----- Build DOM structure -----
      var swiperDiv = document.createElement("div");
      swiperDiv.className = "swiper";
      swiperDiv.style.width = "100%";

      var wrapperDiv = document.createElement("div");
      wrapperDiv.className = "swiper-wrapper";

      slideElements.forEach(function (s) {
        wrapperDiv.appendChild(s);
      });
      swiperDiv.appendChild(wrapperDiv);

      el.innerHTML = "";
      el.appendChild(swiperDiv);

      var prevBtn = null;
      var nextBtn = null;
      if (navigation) {
        prevBtn = document.createElement("div");
        prevBtn.className = "swiper-button-prev";
        nextBtn = document.createElement("div");
        nextBtn.className = "swiper-button-next";
        el.appendChild(prevBtn);
        el.appendChild(nextBtn);
      }

      var pagEl = null;
      if (pagination !== "none") {
        pagEl = document.createElement("div");
        pagEl.className = "swiper-pagination";
        el.appendChild(pagEl);
      }

      // ----- Initialize vanilla Swiper -----
      try {
        var sw = new Swiper(swiperDiv, {
          slidesPerView: smSlidesPerView,
          spaceBetween: spaceBetween,
          loop: loop,
          direction: direction,
          centeredSlides: centered,
          // VIEWPORT-keyed breakpoint, matching the CSS @media threshold —
          // container-based thresholds kept a carousel in a sub-768px column
          // (any 2-column section) on the mobile count even on desktop.
          // Mirrors dm-list.js + carousel-layout.tsx (which picks the
          // effective count per canvas breakpoint in React).
          breakpointsBase: "window",
          breakpoints: {
            768: { slidesPerView: slidesPerView },
          },
          navigation:
            navigation && prevBtn && nextBtn
              ? { nextEl: nextBtn, prevEl: prevBtn }
              : false,
          pagination:
            pagination !== "none" && pagEl
              ? {
                  el: pagEl,
                  clickable: true,
                  type:
                    pagination === "fraction"
                      ? "fraction"
                      : pagination === "progressbar"
                      ? "progressbar"
                      : "bullets",
                }
              : false,
          autoplay: autoplay
            ? {
                delay: autoplayDelay,
                disableOnInteraction: false,
                pauseOnMouseEnter: pauseOnHover,
              }
            : false,
          speed: speed,
          effect: effect === "fade" ? "fade" : "slide",
          fadeEffect: effect === "fade" ? { crossFade: true } : undefined,
        });

        // Centralized event reception lives in dm-dropmagic.js. Attach
        // the Swiper to the host element so the central listener can call
        // slideTo; emit slide-changes for sibling sync when the carousel
        // opts in via `data-list-sync-siblings="true"` AND has a
        // `data-dm-product-id` (sibling sync is product-scoped).
        if (sw) {
          el.__dmSwiper = sw;
          var productId = el.dataset.dmProductId || null;
          if (
            productId &&
            el.getAttribute("data-list-sync-siblings") === "true"
          ) {
            sw.on("slideChange", function () {
              if (sw.__dmProgrammatic) return;
              var idx = sw.activeIndex;
              var active = el.querySelectorAll(".swiper-slide")[idx];
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

        // Layout reflow reactivity: Swiper's built-in resize listener only
        // watches the window, so a column-width change from a layout reflow
        // (without a window resize) doesn't re-measure slides. A
        // ResizeObserver on the swiper div picks those up. setBreakpoint()
        // is window-keyed now — harmless here, kept for resize coalescing.
        if (typeof ResizeObserver !== "undefined") {
          this._dmRo = new ResizeObserver(function () {
            if (!sw) return;
            sw.updateSize();
            sw.setBreakpoint();
            sw.updateSlides();
            sw.updateSlidesClasses();
            sw.update();
          });
          this._dmRo.observe(swiperDiv);
        }
      } catch (e) {
        console.error("[dm-carousel] Swiper init failed", e);
      }
    }

    disconnectedCallback() {
      if (this._dmRo) {
        this._dmRo.disconnect();
        this._dmRo = null;
      }
      // Best-effort Swiper teardown. `destroy(true, true)` removes the
      // Swiper instance + cleans its DOM modifications. Safe to call
      // even if the host has already been removed from the document.
      if (this.__dmSwiper) {
        try {
          this.__dmSwiper.destroy(true, true);
        } catch (e) {
          /* swallow — element is leaving the DOM anyway */
        }
        this.__dmSwiper = null;
      }
    }
  }

  customElements.define("dm-carousel", DmCarousel);
})();
