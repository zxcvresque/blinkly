/* Shared bedtime scheduling. All clock calculations use the selected timezone. */
(function (scope) {
  'use strict';
  const defaults = Object.freeze({
    sleepEnabled: true,
    bedtime: '04:00',
    sleepLeadMin: 120,
    sleepMode: 'voices',
    sleepWorkMin: 10,
    sleepLateStyle: 'drunk',
    sleepTimezone: 'Asia/Kolkata'
  });
  const DAY = 24 * 60, AFTER_BED = 120, NIGHT_LEAD = 180;
  const wrap = minutes => ((minutes % DAY) + DAY) % DAY;
  function integer(value, min, max, fallback) {
    if (typeof value !== 'number' && typeof value !== 'string') return fallback;
    const number = Number(value);
    return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
  }
  function validZone(value) {
    if (value === 'local') return true;
    if (typeof value !== 'string' || !value || value.length > 128) return false;
    try { new Intl.DateTimeFormat('en-GB', { timeZone: value }); return true; }
    catch { return false; }
  }
  function normalize(config = {}) {
    const cfg = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
    return {
      ...cfg,
      sleepEnabled: typeof cfg.sleepEnabled === 'boolean' ? cfg.sleepEnabled : defaults.sleepEnabled,
      bedtime: typeof cfg.bedtime === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(cfg.bedtime)
        ? cfg.bedtime : defaults.bedtime,
      sleepLeadMin: integer(cfg.sleepLeadMin, 30, 300, defaults.sleepLeadMin),
      sleepMode: ['voices', 'frequent'].includes(cfg.sleepMode) ? cfg.sleepMode : defaults.sleepMode,
      sleepWorkMin: integer(cfg.sleepWorkMin, 1, 60, defaults.sleepWorkMin),
      sleepLateStyle: ['sleepy', 'drunk'].includes(cfg.sleepLateStyle) ? cfg.sleepLateStyle : defaults.sleepLateStyle,
      sleepTimezone: validZone(cfg.sleepTimezone) ? cfg.sleepTimezone : defaults.sleepTimezone
    };
  }
  function formatTime(minutes) {
    const value = wrap(minutes);
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
  }
  function info(config = {}, date = new Date()) {
    const cfg = normalize(config);
    const zone = cfg.sleepTimezone === 'local'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' : cfg.sleepTimezone;
    const candidate = date instanceof Date ? date : new Date(date);
    const instant = Number.isFinite(candidate.getTime()) ? candidate : new Date(0);
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(instant);
    const component = type => Number(parts.find(part => part.type === type).value);
    const nowMinutes = wrap(component('hour') * 60 + component('minute'));
    const [hour, minute] = cfg.bedtime.split(':').map(Number);
    const bedtimeMinutes = hour * 60 + minute;
    const windDownMinutes = wrap(bedtimeMinutes - cfg.sleepLeadMin);
    const nightMinutes = wrap(windDownMinutes - NIGHT_LEAD);
    const nearSleep = cfg.sleepEnabled && wrap(nowMinutes - windDownMinutes) < cfg.sleepLeadMin + AFTER_BED;
    const beforeWindDown = cfg.sleepEnabled && wrap(nowMinutes - nightMinutes) < NIGHT_LEAD;
    const period = !cfg.sleepEnabled ? 'day' : nearSleep
      ? cfg.sleepLateStyle === 'drunk' ? 'drunk' : 'night'
      : beforeWindDown ? 'night' : 'day';
    return {
      enabled: cfg.sleepEnabled, zone, bedtime: cfg.bedtime, nowMinutes,
      minutesUntilBed: wrap(bedtimeMinutes - nowMinutes),
      minutesAfterBed: wrap(nowMinutes - bedtimeMinutes),
      nearSleep, period,
      bedtimeMinutes, windDownMinutes,
      windDownStart: formatTime(windDownMinutes), nightStart: formatTime(nightMinutes)
    };
  }
  const period = (config, date) => info(config, date).period;
  function effectiveWorkMin(config = {}, date = new Date()) {
    const cfg = normalize(config), base = integer(cfg.workMin, 1, 60, 20);
    return cfg.sleepMode === 'frequent' && info(cfg, date).nearSleep ? Math.min(base, cfg.sleepWorkMin) : base;
  }
  const api = Object.freeze({ defaults, normalize, normalise: normalize, info, period, effectiveWorkMin, formatTime });
  scope.BlinklySleep = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
