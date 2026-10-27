/**
 * DropMagic Media — single source of truth for both surfaces.
 *
 * - Storefront: loaded via Liquid `<script src>` in `dm-page.liquid`.
 * - Editor canvas: `?raw`-imported in
 *   `src/components/builder/canvas/runtime-scripts.ts` and injected as
 *   inline `<script>.textContent` into the iframe doc.
 *
 * The Media atom's video wrapper is a plain `<div data-media-video-style>`
 * (not a custom element), so behavior is attached via delegated document
 * click handlers — same model as `dm-option-picker.js`. Delegation on
 * `document` self-heals across json-render re-keys (the listener never
 * moves) and the init flag below makes re-injection a no-op. Two styles
 * are interactive:
 *   - `silent`  — autoplaying muted loop; click toggles mute/unmute
 *                 (`dm-unmuted` flips the speaker glyph). In the edit
 *                 canvas (`data-dm-edit`) only the speaker button toggles —
 *                 a click on the video is a selection click.
 *   - `minimal` — a poster with a CSS play glyph. First click plays WITH
 *                 sound (minimal is not muted) and reveals the browser's
 *                 native controls (volume, scrubber, fullscreen);
 *                 `dm-playing` hides the glyph. Any pause/end reverts to the
 *                 clean poster (controls off, glyph back) — including the
 *                 pause() dm-dialog.js fires on close.
 * `native` uses the browser's own `controls` always, so it needs no handler.
 *
 * Plain ES2017, no transpilation. IIFE-wrapped. Idempotent (re-running
 * is a no-op).
 */
(function () {
  if (window.__dmMediaInit) return;
  window.__dmMediaInit = true;

  // The edit canvas sets `data-dm-edit` on <html> (iframe-canvas.tsx).
  function isEdit() {
    return document.documentElement.hasAttribute('data-dm-edit');
  }

  // Video silent style: click to toggle mute/unmute. Storefront: the whole
  // video is the toggle. Edit canvas: a click on the video SELECTS the atom,
  // so only the speaker button toggles — its pseudos are hit targets (see
  // the `pointer-events: auto` rule in dm-theme.css), so `e.target` is the
  // glyph layer rather than the <video>.
  document.addEventListener('click', function (e) {
    var wrapper = e.target.closest('[data-media-video-style="silent"]');
    if (!wrapper) return;
    if (isEdit() && !e.target.hasAttribute('data-media-glyph')) return;
    var video = wrapper.querySelector('video');
    if (!video) return;
    video.muted = !video.muted;
    wrapper.classList.toggle('dm-unmuted', !video.muted);
  });

  // Video minimal style: a poster with a play glyph. First click turns it
  // into a real player — reveal the browser's native controls (volume,
  // scrubber, fullscreen) and play WITH sound (minimal is not muted). While
  // playing, the native bar owns play/pause/volume, so we bail early. Any
  // pause/end reverts to the clean poster: controls off, glyph back.
  document.addEventListener('click', function (e) {
    var wrapper = e.target.closest('[data-media-video-style="minimal"]');
    if (!wrapper) return;
    var video = wrapper.querySelector('video');
    if (!video) return;
    // Playing → the native control bar handles play/pause/volume itself.
    if (wrapper.classList.contains('dm-playing')) return;
    video.controls = true;
    wrapper.classList.add('dm-playing');
    video.play().catch(function () {});
    // Revert to the clean poster on any pause/end (native pause button, end
    // of clip, or the dialog-close pause()). Bound once per <video>.
    if (!video.__dmMinimalRevertBound) {
      video.__dmMinimalRevertBound = true;
      var revert = function () {
        video.controls = false;
        wrapper.classList.remove('dm-playing');
      };
      video.addEventListener('pause', revert);
      video.addEventListener('ended', revert);
    }
  });
})();
