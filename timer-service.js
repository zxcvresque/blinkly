/* One serialized timer for every extension tab, popup, and browser window. */
(function (scope) {
  'use strict';
  function create({ storage, sleep, preferences, now = () => Date.now(), activeTab = async () => null }) {
    let queue = Promise.resolve();
    const fresh = at => ({ phase: 'work', elapsed: 0, breakEnd: 0, breakLen: 20, paused: false,
      lastTick: 0, owner: '', lastAct: at, res: '', resAt: 0, resUntil: 0, days: {},
      snoozeCount: 0, voiceEvent: null, mediaNotified: false, manualBreak: false, warned: false,
      timerSchema: 1, revision: 0, w: 'worker' });
    const day = (state, at) => {
      const key = new Date(at).toLocaleDateString('en-CA');
      state.days ||= {};
      state.days[key] ||= { d: 0, s: 0, a: 0 };
      Object.keys(state.days).sort().slice(0, -14).forEach(old => delete state.days[old]);
      return state.days[key];
    };
    function finish(state, config, at, kind) {
      const stale = at - state.breakEnd > 60000, sessionId = String(state.breakEnd);
      state.phase = 'work'; state.elapsed = 0; state.snoozeCount = 0; state.mediaNotified = false;
      state.warned = false; state.lastTick = at;
      if (kind === 'done' && !stale) {
        day(state, at).d++; state.res = 'done'; state.resAt = at;
        state.resUntil = at + (config.voiceOn !== false && config.voiceDone !== false ? 9000 : 3400);
        state.voiceEvent = { id: `done:${sessionId}`, type: 'done', at, sessionId };
      } else {
        state.res = kind === 'skip' ? 'skip' : ''; state.resAt = at; state.resUntil = 0;
        if (kind === 'skip') day(state, at).s++;
      }
    }
    function start(state, config, at, manual) {
      if (state.phase === 'break') return;
      state.phase = 'break'; state.breakLen = config.breakSec; state.breakEnd = at + config.breakSec * 1000;
      state.manualBreak = manual; state.res = ''; state.resUntil = 0; state.lastTick = at;
    }
    async function execute(message, sender) {
      const at = now(), stored = await storage.get(['state', 'timerState', 'cfg']);
      // The separate authority record prevents an old, not-yet-refreshed content
      // script from replacing the timer by writing its former local snapshot.
      const prior = stored.timerState?.timerSchema === 1 ? stored.timerState : stored.state || {};
      const state = { ...fresh(at), ...prior, timerSchema: 1, w: 'worker' };
      const config = { ...sleep.defaults, ...preferences.defaults, workMin: 20, breakSec: 20,
        idleMin: 2, warnSec: 30, deferMedia: true, ...(stored.cfg || {}) };
      config.breakSec = Math.max(10, Math.min(120, Number(config.breakSec) || 20));
      const work = sleep.effectiveWorkMin(config, new Date(at)) * 60;
      const action = message.action;
      if (!['snapshot', 'tick', 'activity', 'start', 'finish', 'skip', 'snooze', 'pause', 'restart', 'presentation'].includes(action))
        throw new Error('Invalid timer action');
      let changed = !stored.timerState, resetAfterIdle = false;
      const foreground = ['tick', 'activity'].includes(action)
        ? Number.isInteger(sender?.tab?.id) && sender.tab.id === await activeTab() : true;
      if (action === 'activity' && foreground && at - state.lastAct > 5000) {
        if (at - state.lastAct > config.idleMin * 60000 && state.phase === 'work' && !state.paused && state.elapsed > 0) {
          state.elapsed = 0; state.snoozeCount = 0; state.mediaNotified = false; state.warned = false;
          state.lastTick = at; resetAfterIdle = true;
        }
        state.lastAct = at; changed = true;
      }
      if (action === 'tick') {
        const quiet = preferences.quietNow(config, new Date(at));
        if (quiet && !(state.phase === 'break' && state.manualBreak)) {
          if (state.phase === 'break') {
            state.phase = 'work'; state.breakEnd = 0; state.res = ''; state.lastTick = at; changed = true;
          }
        } else if (state.phase === 'break') {
          if (at >= state.breakEnd) { finish(state, config, at, 'done'); changed = true; }
        } else if (foreground && !state.paused && at - state.lastAct <= config.idleMin * 60000
          && (!state.lastTick || at - state.lastTick >= 1000)) {
          // Multiple tabs may heartbeat at once, but only this serialized clock
          // may advance. A suspended browser never catches up minutes of work.
          const seconds = state.lastTick ? Math.max(1, Math.min(2, Math.floor((at - state.lastTick) / 1000))) : 1;
          state.elapsed = Math.max(0, Number(state.elapsed) || 0) + seconds;
          state.lastTick = at; state.owner = 'worker'; day(state, at).a += seconds; changed = true;
          const left = work - state.elapsed;
          if (left > config.warnSec) state.warned = false;
          else if (config.warnSec > 0 && left > 0 && !state.warned) {
            state.warned = true;
            state.voiceEvent = { id: `warn:${at}:${state.revision}`, type: 'warn', at };
          }
          if (left <= 0) {
            if (config.deferMedia && message.mediaPlaying === true && state.elapsed < work + 900) state.mediaNotified = true;
            else start(state, config, at, false);
          }
        }
      }
      if (action === 'start' && state.phase !== 'break') { start(state, config, at, message.manual !== false); changed = true; }
      if (['finish', 'skip'].includes(action) && state.phase === 'break'
        && String(state.breakEnd) === message.sessionId && (action === 'skip' && !config.strict || action === 'finish' && at >= state.breakEnd)) {
        finish(state, config, at, action === 'skip' ? 'skip' : 'done'); changed = true;
      }
      if (action === 'snooze' && !config.strict) {
        const sessionId = state.phase === 'break' ? String(state.breakEnd) : null;
        if (state.phase === 'break') day(state, at).s++;
        state.phase = 'work'; state.elapsed = Math.max(0, work - 300); state.res = ''; state.resUntil = 0;
        state.snoozeCount = (state.snoozeCount || 0) + 1; state.warned = false; state.lastTick = at;
        state.voiceEvent = { id: `snooze:${at}:${state.revision}`, type: 'snooze', at, ...(sessionId ? { sessionId } : {}) };
        changed = true;
      }
      if (action === 'pause') {
        state.paused = !state.paused; state.lastTick = at;
        state.voiceEvent = { id: `pause:${at}:${state.revision}`, type: state.paused ? 'pause' : 'resume', at };
        changed = true;
      }
      if (action === 'restart') {
        state.phase = 'work'; state.elapsed = 0; state.snoozeCount = 0; state.mediaNotified = false;
        state.res = ''; state.resUntil = 0; state.warned = false; state.lastTick = at; changed = true;
        state.manualBreak = false;
      }
      if (action === 'presentation' && state.res === 'done' && state.resAt === message.resAt
        && String(state.breakEnd) === message.sessionId && Number.isFinite(message.resUntil)) {
        state.resUntil = Math.max(at, Math.min(state.resAt + 20000, message.resUntil)); changed = true;
      }
      if (changed) {
        state.revision = (Number.isSafeInteger(state.revision) ? state.revision : 0) + 1;
        await storage.set({ timerState: state, state });
      } else if (JSON.stringify(stored.state) !== JSON.stringify(state)) await storage.set({ state });
      return { ok: true, state, resetAfterIdle };
    }
    return Object.freeze({ request(message, sender) {
      const next = queue.then(() => execute(message, sender));
      queue = next.catch(() => {});
      return next;
    } });
  }
  const api = Object.freeze({ create });
  scope.BlinklyTimerService = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
