/* Shared reminder preferences. Equal quiet-hour endpoints mean a full quiet day. */
(function (scope) {
  'use strict';
  const defaults = Object.freeze({
    quietEnabled: false, quietStart: '23:00', quietEnd: '07:00', factsEvery: 3,
    favoriteClips: Object.freeze([]), mutedClips: Object.freeze([])
  });
  const FACT_FREQUENCIES = Object.freeze([0, 1, 2, 3, 5, 10]);
  const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/, KEY = /^vo_[a-z0-9]+$/;
  const clipList = value => Array.isArray(value)
    ? [...new Set(value.filter(key => typeof key === 'string' && KEY.test(key)))].slice(0, 512) : [];
  function normalize(config = {}) {
    const cfg = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
    const frequency = typeof cfg.factsEvery === 'number' || typeof cfg.factsEvery === 'string' && cfg.factsEvery.trim() !== ''
      ? Number(cfg.factsEvery) : NaN;
    return {
      ...cfg,
      quietEnabled: typeof cfg.quietEnabled === 'boolean' ? cfg.quietEnabled : defaults.quietEnabled,
      quietStart: typeof cfg.quietStart === 'string' && TIME.test(cfg.quietStart) ? cfg.quietStart : defaults.quietStart,
      quietEnd: typeof cfg.quietEnd === 'string' && TIME.test(cfg.quietEnd) ? cfg.quietEnd : defaults.quietEnd,
      factsEvery: FACT_FREQUENCIES.includes(frequency) ? frequency : defaults.factsEvery,
      favoriteClips: clipList(cfg.favoriteClips), mutedClips: clipList(cfg.mutedClips)
    };
  }
  const minutes = value => { const [hour, minute] = value.split(':').map(Number); return hour * 60 + minute; };
  function quietNow(config = {}, date = new Date()) {
    const cfg = normalize(config);
    if (!cfg.quietEnabled) return false;
    let now;
    try {
      if (scope.BlinklySleep) now = scope.BlinklySleep.info(cfg, date).nowMinutes;
      else {
        let zone = cfg.sleepTimezone || 'Asia/Kolkata';
        if (zone === 'local') zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        try { new Intl.DateTimeFormat('en-GB', { timeZone: zone }); }
        catch { zone = 'Asia/Kolkata'; }
        const parts = new Intl.DateTimeFormat('en-GB', {
          timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
        }).formatToParts(date);
        now = Number(parts.find(part => part.type === 'hour').value) * 60 + Number(parts.find(part => part.type === 'minute').value);
      }
    } catch { return false; }
    const start = minutes(cfg.quietStart), end = minutes(cfg.quietEnd);
    return start === end || (start < end ? now >= start && now < end : now >= start || now < end);
  }
  function eligible(texts, config = {}, keyfn = value => value) {
    if (!Array.isArray(texts)) return [];
    const cfg = normalize(config), muted = new Set(cfg.mutedClips), favorites = new Set(cfg.favoriteClips);
    const remaining = [...new Set(texts)].filter(text => !muted.has(keyfn(text)));
    const preferred = remaining.filter(text => favorites.has(keyfn(text)));
    return preferred.length ? preferred : remaining;
  }
  const api = Object.freeze({ defaults, normalize, normalise: normalize, quietNow, eligible, FACT_FREQUENCIES });
  scope.BlinklyPreferences = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
