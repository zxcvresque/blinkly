/* Scroll owns the clock: blend captured half-second rest frames without autoplay. */
(function (scope) {
  'use strict';
  const clamp = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

  function create({ canvas, poster, manifest, Image: ImageClass = scope.Image, concurrency = 4 } = {}) {
    if (!canvas || !manifest?.frames?.length) throw new Error('A canvas and rest-frame manifest are required.');
    const frames = manifest.frames.map((frame, index) => ({
      time: Number(frame.time), src: frame.src, index, status: 'idle', image: null
    }));
    if (frames.some((frame, index) => !Number.isFinite(frame.time) || !frame.src || index && frame.time <= frames[index - 1].time)) {
      throw new Error('Rest frames must have ascending times and image sources.');
    }
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('A canvas drawing context is required.');
    canvas.width = manifest.width || 1440;
    canvas.height = manifest.height || 900;
    canvas.style.opacity = '0';
    const duration = Number(manifest.duration) || frames.at(-1).time || 20;
    const limit = Math.max(1, Math.min(4, Math.floor(concurrency) || 4));
    let destroyed = false, started = false, pending = 0, loaded = 0, failed = 0;
    let progress = 0, time = 0, lower = 0, upper = 0, mix = 0, drawn = -1;

    function state() {
      return Object.freeze({ progress, time, frameIndex: mix < .5 ? lower : upper,
        lowerFrameIndex: lower, upperFrameIndex: upper, drawnFrame: drawn,
        ready: frames[lower].status === 'loaded' && frames[upper].status === 'loaded',
        loadedFrames: loaded, pendingFrames: pending, failedFrames: failed, destroyed });
    }
    function describe() {
      const value = state();
      Object.assign(canvas.dataset, {
        progress: String(progress), time: String(time), frameIndex: String(value.frameIndex),
        lowerFrameIndex: String(lower), upperFrameIndex: String(upper),
        drawnFrame: String(drawn), ready: String(value.ready), displayReady: String(drawn >= 0),
        loadedFrames: String(loaded), failedFrames: String(failed), destroyed: String(destroyed)
      });
    }
    function draw() {
      if (destroyed) return;
      let first, second, alpha = 0;
      if (frames[lower].status === 'loaded' && frames[upper].status === 'loaded') {
        first = frames[lower]; second = frames[upper]; alpha = mix;
      } else {
        // Keep a real frame visible even when a fast scroll outruns decoding.
        first = frames.filter(frame => frame.status === 'loaded')
          .sort((a, b) => Math.abs(a.time - time) - Math.abs(b.time - time))[0];
      }
      if (first) {
        context.globalAlpha = 1;
        context.drawImage(first.image, 0, 0, canvas.width, canvas.height);
        if (second && second !== first && alpha > 0) {
          context.globalAlpha = alpha;
          context.drawImage(second.image, 0, 0, canvas.width, canvas.height);
          context.globalAlpha = 1;
        }
        drawn = second && alpha >= .5 ? second.index : first.index;
        canvas.style.opacity = '1';
      }
      describe();
    }
    function pump() {
      if (destroyed || !started) return;
      const priority = frames.filter(frame => frame.status === 'idle').sort((a, b) => {
        const rank = frame => frame.index === lower || frame.index === upper ? -1 : Math.abs(frame.time - time);
        return rank(a) - rank(b) || a.index - b.index;
      });
      while (pending < limit && priority.length) load(priority.shift());
    }
    function load(frame) {
      frame.status = 'loading'; pending++;
      const image = frame.image = new ImageClass();
      image.decoding = 'async';
      let settled = false;
      function finish(ok) {
        if (settled || destroyed) return;
        settled = true; image.onload = image.onerror = null;
        pending--; frame.status = ok ? 'loaded' : 'failed';
        if (ok) loaded++; else { failed++; frame.image = null; }
        draw(); pump();
      }
      image.onload = () => {
        // A decoded image can be drawn immediately during a later scroll event.
        if (typeof image.decode === 'function') image.decode().then(() => finish(true), () => finish(image.naturalWidth > 0));
        else finish(true);
      };
      image.onerror = () => finish(false);
      image.src = frame.src;
    }
    function setProgress(value) {
      if (destroyed) return state();
      progress = clamp(Number(value)); time = progress * duration;
      lower = 0;
      while (lower < frames.length - 1 && frames[lower + 1].time <= time) lower++;
      upper = time <= frames[lower].time || lower === frames.length - 1 ? lower : lower + 1;
      mix = upper === lower ? 0 : clamp((time - frames[lower].time) / (frames[upper].time - frames[lower].time));
      started = true; draw(); pump();
      return state();
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const frame of frames) {
        if (frame.image) {
          frame.image.onload = frame.image.onerror = null;
          if (frame.status === 'loading') frame.image.removeAttribute?.('src');
          frame.image = null;
        }
      }
      pending = 0; describe();
    }
    // The poster stays beneath the canvas until the first decoded frame is drawn.
    // Its visibility belongs to the page, including the reduced-motion fallback.
    void poster;
    describe();
    return Object.freeze({ setProgress, getState: state, destroy });
  }
  const api = Object.freeze({ create });
  scope.BlinklyScrollPreview = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
