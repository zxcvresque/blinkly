/* Viewport-relative timer placement. x/y describe the available top-left travel. */
(function (scope) {
  'use strict';
  const defaults = Object.freeze({ widgetPosition: null, warmNow: false });
  const finite = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const dimension = value => Math.max(0, finite(value));
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  function validPosition(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
      && typeof value.x === 'number' && Number.isFinite(value.x) && value.x >= 0 && value.x <= 1
      && typeof value.y === 'number' && Number.isFinite(value.y) && value.y >= 0 && value.y <= 1;
  }
  function normalize(config = {}) {
    const cfg = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
    return {
      ...cfg,
      widgetPosition: validPosition(cfg.widgetPosition) ? { x: cfg.widgetPosition.x, y: cfg.widgetPosition.y } : null,
      warmNow: typeof cfg.warmNow === 'boolean' ? cfg.warmNow : defaults.warmNow
    };
  }
  function axis(size, viewport, margin) {
    const room = Math.max(0, dimension(viewport) - dimension(size));
    // Keep symmetric margins when space permits; never hide the grab area offscreen.
    const inset = Math.min(Math.max(0, finite(margin, 8)), room / 2);
    return { minimum: inset, travel: Math.max(0, room - inset * 2) };
  }
  function coordinates(position, width, height, viewportWidth, viewportHeight, margin = 8) {
    const point = validPosition(position) ? position : { x: 1, y: 1 };
    const horizontal = axis(width, viewportWidth, margin), vertical = axis(height, viewportHeight, margin);
    return {
      x: horizontal.minimum + point.x * horizontal.travel,
      y: vertical.minimum + point.y * vertical.travel
    };
  }
  function clampPointerToPosition(clientX, clientY, grabX, grabY, width, height, viewportWidth, viewportHeight, margin = 8) {
    const horizontal = axis(width, viewportWidth, margin), vertical = axis(height, viewportHeight, margin);
    const relative = (pointer, grab, bounds) => bounds.travel
      ? clamp((finite(pointer) - finite(grab) - bounds.minimum) / bounds.travel, 0, 1) : 0;
    return { x: relative(clientX, grabX, horizontal), y: relative(clientY, grabY, vertical) };
  }
  const api = Object.freeze({ defaults, normalize, normalise: normalize, coordinates, clampPointerToPosition });
  scope.BlinklyPlacement = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
