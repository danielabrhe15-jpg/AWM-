/**
 * dm-delivery-date.js — vanilla delivery-date init for Shopify.
 * Mirror of `src/components/builder/blocks/atoms/delivery-date/runtime.ts`.
 * Keep both in sync when the algorithm changes (different runtimes:
 * Vite-bundled iframe vs plain <script>, so the source can't be literally
 * shared without a build step).
 *
 * Computes `delivery.now / .dispatched / .delivered` once on mount from
 * day-offset attributes and writes them into [data-bind="delivery.X"]
 * descendants. No interval — dates only depend on the visit day.
 */
(function () {
  var LOCALE_MAP = {
    en: "en-US", es: "es-ES", fr: "fr-FR", pt: "pt-PT", de: "de-DE",
    it: "it-IT", nl: "nl-NL", pl: "pl-PL", ro: "ro-RO", el: "el-GR",
    cs: "cs-CZ", hu: "hu-HU", sv: "sv-SE", da: "da-DK", fi: "fi-FI",
    no: "no-NO", sk: "sk-SK", bg: "bg-BG", tr: "tr-TR", id: "id-ID",
    vi: "vi-VN", sr: "sr-RS", hr: "hr-HR", bs: "bs-BA", sl: "sl-SI",
    lt: "lt-LT", lv: "lv-LV", et: "et-EE", uk: "uk-UA", mk: "mk-MK",
    is: "is-IS", ru: "ru-RU", mt: "mt-MT"
  };

  function pickLocale() {
    var code = (window.Shopify && window.Shopify.locale) || "en";
    return LOCALE_MAP[code] || "en-US";
  }

  function formatOptions(format) {
    if (format === "long") return { weekday: "short", month: "short", day: "numeric" };
    if (format === "medium") return { day: "numeric", month: "short", year: "numeric" };
    return { day: "numeric", month: "short" };
  }

  function addDays(d, days) {
    var next = new Date(d);
    next.setDate(d.getDate() + days);
    return next;
  }

  function formatRange(minDays, maxDays, locale, format) {
    var today = new Date();
    var opts = formatOptions(format);
    function fmt(date) {
      try {
        return new Intl.DateTimeFormat(locale, opts).format(date);
      } catch (e) {
        return new Intl.DateTimeFormat("en-US", opts).format(date);
      }
    }
    var start = fmt(addDays(today, minDays));
    if (minDays === maxDays) return start;
    var end = fmt(addDays(today, maxDays));
    return start + " - " + end;
  }

  function setup(el) {
    if (el.dataset.dmInit) return;
    el.dataset.dmInit = "1";

    var dispatchedMin =
      parseInt(el.getAttribute("data-delivery-dispatched-min") || "0", 10) || 0;
    var dispatchedMax =
      parseInt(el.getAttribute("data-delivery-dispatched-max") || "0", 10) || 0;
    var deliveredMin =
      parseInt(el.getAttribute("data-delivery-delivered-min") || "0", 10) || 0;
    var deliveredMax =
      parseInt(el.getAttribute("data-delivery-delivered-max") || "0", 10) || 0;
    var format = el.getAttribute("data-delivery-format") || "short";

    var locale = pickLocale();

    function writeAll(key, value) {
      var nodes = el.querySelectorAll('[data-bind="delivery.' + key + '"]');
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].textContent !== value) nodes[i].textContent = value;
      }
    }

    writeAll("now", formatRange(0, 0, locale, format));
    writeAll("dispatched", formatRange(dispatchedMin, dispatchedMax, locale, format));
    writeAll("delivered", formatRange(deliveredMin, deliveredMax, locale, format));
  }

  document.querySelectorAll("dm-delivery-date").forEach(setup);
})();
