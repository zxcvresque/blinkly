/* Lazy Web Audio activation. Context creation and resume are separate operations. */
(function (scope, factory) {
  'use strict';
  const api = factory(scope);
  scope.BlinklyAudioActivation = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis, function (scope) {
  'use strict';
  const GESTURES = new Set(['click', 'pointerup', 'keydown']);
  function create(options = {}) {
    const getContextClass = () => options.Context || scope.AudioContext || scope.webkitAudioContext
      || scope.window?.AudioContext || scope.window?.webkitAudioContext;
    const getActivation = typeof options.getActivation === 'function' ? options.getActivation
      : () => scope.navigator?.userActivation || scope.window?.navigator?.userActivation;
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 800;
    const onReady = typeof options.onReady === 'function' ? options.onReady : () => {};
    let context = null, pending = null, authorized = false;
    const activation = () => {
      try {
        const state = getActivation();
        return { supported: typeof state?.hasBeenActive === 'boolean' || typeof state?.isActive === 'boolean',
          active: state?.hasBeenActive === true || state?.isActive === true };
      } catch { return { supported: true, active: false }; }
    };
    function get() {
      if (context && context.state !== 'closed') return context;
      const Context = getContextClass();
      if ((!authorized && !activation().active) || typeof Context !== 'function') return null;
      try {
        context = new Context();
        const created = context;
        let lastState = created.state;
        created.addEventListener?.('statechange', () => {
          const state = created.state, becameRunning = state === 'running' && lastState !== 'running';
          lastState = state;
          if (context !== created || !becameRunning) return;
          // Hardware activation can finish after unlock's bounded wait expires.
          // Consumer failures must never escape a native audio state event.
          try { Promise.resolve(onReady(created)).catch(() => {}); } catch {}
        });
      } catch { context = null; }
      return context;
    }
    function peek() { return context; }
    function ready() {
      if (context?.state === 'running') return Promise.resolve(context);
      return pending || Promise.resolve(null);
    }
    function unlock(event) {
      const trustedGesture = event?.isTrusted === true && GESTURES.has(event.type);
      const state = activation();
      // In extension isolated worlds the page activation flag can lag behind a
      // genuine click. Resume within that trusted click's synchronous stack.
      const trustedClick = event?.isTrusted === true && event.type === 'click' && (event.button === undefined || event.button === 0);
      const existingPermission = authorized && context && context.state !== 'closed';
      if (!state.active && !trustedClick && !existingPermission && (state.supported || !trustedGesture)) return Promise.resolve(null);
      authorized = true;
      if (pending) return pending;
      const current = get();
      if (!current) return Promise.resolve(null);
      if (current.state === 'running') return Promise.resolve(current);
      let complete;
      const promise = new Promise(resolve => { complete = resolve; });
      pending = promise;
      let settled = false, timer;
      const finish = () => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (pending === promise) pending = null;
        complete(current.state === 'running' ? current : null);
      };
      timer = setTimeout(finish, timeoutMs);
      // Calling resume in this stack preserves the trusted browser event gesture.
      try { Promise.resolve(current.resume()).then(finish, finish); }
      catch { finish(); }
      return promise;
    }
    return Object.freeze({ get, unlock, ready, peek });
  }
  return Object.freeze({ create });
});
