/* A standalone, local 20-second preview. Never touches the extension's timer or storage. */
(function (scope) {
  'use strict';
  const STEPS = [
    ['Look at something 20 feet away', 'Pick a distant point: a building, a tree, the sky.'],
    ['Let your eyes go soft', 'Rest on it. No need to strain for focus.'],
    ['Blink slowly', 'Close fully each time. It re-wets the surface of your eyes.'],
    ['Drop your shoulders', 'Unclench your jaw and breathe out.']
  ];
  const DURATION = 20000;
  const ELIGIBILITY_QUERY = '(min-width: 1024px) and (orientation: landscape) and (hover: hover) and (pointer: fine)';
  function isEligible() {
    const nav = scope.navigator || {};
    const mobile = nav.userAgentData?.mobile || /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent || '');
    const iPadDesktop = nav.platform === 'MacIntel' && nav.maxTouchPoints > 1;
    return Boolean(scope.matchMedia?.(ELIGIBILITY_QUERY).matches) && !mobile && !iPadDesktop;
  }
  function create({ trigger, onOpen = () => {}, onStart = () => {}, onComplete = () => {}, onClose = () => {}, onEligibilityChange = () => {} } = {}) {
    const doc = trigger?.ownerDocument || scope.document;
    const dialog = doc.createElement('dialog');
    dialog.className = 'blinkly-rest-demo';
    dialog.setAttribute('aria-label', 'Try a 20-second Blinkly rest');
    dialog.innerHTML = `
      <div class="rest-scene"><canvas aria-hidden="true"></canvas><div class="rest-lid top"></div><div class="rest-lid bottom"></div></div>
      <div class="rest-box">
        <div class="rest-top"><div class="rest-num" data-rest-num role="timer" aria-label="Seconds remaining" aria-live="off">20</div><h2 class="rest-title" data-rest-title></h2><p class="rest-sub" data-rest-sub></p></div>
        <div class="rest-bottom"><p class="rest-tip">Looking out a window works as well as anything else 20 feet away.</p><div class="rest-actions"><button type="button" class="rest-button" data-rest-skip>Skip break</button><button type="button" class="rest-button" data-rest-replay hidden>Try again</button><button type="button" class="rest-button" data-rest-return hidden>Back to Blinkly</button></div></div>
      </div>
      <p class="rest-meta">Blinkly · 20-second preview · No installation needed</p>
      <button type="button" class="rest-close" data-rest-close aria-label="Close rest preview">Close preview</button>
      <p class="rest-audio-status" data-rest-audio-status role="status" aria-live="polite" hidden></p>
      <span class="rest-status" role="status" aria-live="polite" data-rest-status></span>`;
    doc.body.appendChild(dialog);
    const $ = selector => dialog.querySelector(selector);
    const number = $('[data-rest-num]'), title = $('[data-rest-title]'), subtitle = $('[data-rest-sub]');
    const replay = $('[data-rest-replay]'), back = $('[data-rest-return]'), skip = $('[data-rest-skip]');
    const closeButton = $('[data-rest-close]'), status = $('[data-rest-status]');
    const lidTop = $('.rest-lid.top'), lidBottom = $('.rest-lid.bottom');
    const motion = scope.matchMedia('(prefers-reduced-motion: reduce)');
    const eligibility = scope.matchMedia(ELIGIBILITY_QUERY);
    let active = false, destroyed = false, scene = null, interval = 0, frame = 0;
    let lastEligibility = isEligible();
    let started = 0, previousFrame = 0, lastStep = -1, lastSecond = -1, returnFocus, previousOverflow;

    function elapsed() { return Math.min(DURATION, Math.max(0, scope.performance.now() - started)); }
    function stopFrame() { scope.cancelAnimationFrame(frame); frame = 0; previousFrame = 0; }
    function stopClock() { scope.clearInterval(interval); interval = 0; stopFrame(); }
    function draw(now = scope.performance.now()) {
      if (!active || doc.visibilityState === 'hidden') return;
      const time = elapsed(), running = dialog.dataset.state === 'running';
      scene?.draw({ progress: time / DURATION, clock: motion.matches ? 0 : time / 1000,
        dt: !motion.matches && previousFrame ? Math.min(.1, (now - previousFrame) / 1000) : 0, accent: '#ef5b78' });
      previousFrame = now;
      const phase = (time / 1000) % 4;
      const blink = !motion.matches && running && lastStep === 2 && phase < .8 ? Math.sin(Math.PI * phase / .8) : 0;
      lidTop.style.transform = `translateY(${-100 + 36 * blink}%)`;
      lidBottom.style.transform = `translateY(${100 - 36 * blink}%)`;
    }
    function animate(now) {
      frame = 0;
      if (!active || motion.matches || doc.visibilityState === 'hidden' || dialog.dataset.state !== 'running') return;
      draw(now);
      frame = scope.requestAnimationFrame(animate);
    }
    function syncFrame() {
      stopFrame(); draw();
      if (active && !motion.matches && doc.visibilityState !== 'hidden' && dialog.dataset.state === 'running') frame = scope.requestAnimationFrame(animate);
    }
    function tick() {
      if (!active) return;
      const time = elapsed(), second = Math.ceil((DURATION - time) / 1000);
      if (time >= DURATION) {
        if (dialog.dataset.state === 'rested') return;
        dialog.dataset.state = 'rested'; stopClock();
        number.textContent = 'Rested'; number.removeAttribute('role'); number.removeAttribute('aria-label');
        title.textContent = 'Your eyes thank you.';
        subtitle.textContent = 'A small pause. Now, back to your day.';
        skip.hidden = true; replay.hidden = back.hidden = false;
        // Keep keyboard focus on a visible control when the skip button disappears.
        if (doc.activeElement === skip) back.focus({ preventScroll: true });
        status.textContent = 'Rested. Your eyes thank you. You can try again or return to Blinkly.';
        draw(); if (doc.visibilityState === 'visible') onComplete(); return;
      }
      if (second !== lastSecond) {
        lastSecond = second; number.textContent = String(second);
        if (motion.matches) draw();
      }
      const step = Math.min(STEPS.length - 1, Math.floor(time / (DURATION / STEPS.length)));
      if (step !== lastStep) {
        lastStep = step; title.textContent = STEPS[step][0]; subtitle.textContent = STEPS[step][1];
        status.textContent = STEPS[step].join('. ');
      }
    }
    function start() {
      stopClock(); started = scope.performance.now(); lastStep = lastSecond = -1;
      dialog.dataset.state = 'running'; skip.hidden = false; replay.hidden = back.hidden = true;
      number.setAttribute('role', 'timer'); number.setAttribute('aria-label', 'Seconds remaining');
      $('[data-rest-audio-status]').hidden = true;
      if (doc.visibilityState === 'visible') onStart();
      tick(); syncFrame(); interval = scope.setInterval(tick, 200);
    }
    function open() {
      if (destroyed) return false;
      if (!isEligible()) { close(); return false; }
      if (active) return false;
      returnFocus = doc.activeElement;
      previousOverflow = doc.documentElement.style.overflow;
      dialog.showModal(); active = true; doc.documentElement.style.overflow = 'hidden';
      if (scope.BlinklyScenes) scene = scope.BlinklyScenes.createRest($('canvas'));
      onOpen(); start(); closeButton.focus({ preventScroll: true }); return true;
    }
    function finish() {
      if (!active) return;
      active = false; stopClock(); scene?.destroy(); scene = null;
      doc.documentElement.style.overflow = previousOverflow;
      dialog.dataset.state = 'idle';
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      onClose();
    }
    function close() { if (dialog.open) dialog.close(); finish(); }
    function restart() { if (!isEligible()) { close(); return; } start(); closeButton.focus({ preventScroll: true }); }
    function visibility() { if (active) { tick(); syncFrame(); } }
    function eligibilityChanged() {
      const allowed = isEligible();
      if (!allowed) close();
      if (allowed !== lastEligibility) { lastEligibility = allowed; onEligibilityChange(allowed); }
    }
    function resized() { eligibilityChanged(); if (active) draw(); }
    function cancel(event) { event.preventDefault(); close(); }
    function closed() { if (!dialog.open) finish(); }
    trigger?.addEventListener('click', open);
    closeButton.addEventListener('click', close); skip.addEventListener('click', close);
    back.addEventListener('click', close); replay.addEventListener('click', restart);
    dialog.addEventListener('cancel', cancel); dialog.addEventListener('close', closed);
    doc.addEventListener('visibilitychange', visibility);
    scope.addEventListener('resize', resized); scope.addEventListener('pagehide', close);
    if (motion.addEventListener) motion.addEventListener('change', syncFrame);
    else motion.addListener(syncFrame);
    if (eligibility.addEventListener) eligibility.addEventListener('change', eligibilityChanged);
    else eligibility.addListener(eligibilityChanged);
    onEligibilityChange(lastEligibility);
    return Object.freeze({ open, close, destroy() {
      if (destroyed) return;
      close(); destroyed = true;
      trigger?.removeEventListener('click', open);
      doc.removeEventListener('visibilitychange', visibility);
      scope.removeEventListener('resize', resized); scope.removeEventListener('pagehide', close);
      if (motion.removeEventListener) motion.removeEventListener('change', syncFrame);
      else motion.removeListener(syncFrame);
      if (eligibility.removeEventListener) eligibility.removeEventListener('change', eligibilityChanged);
      else eligibility.removeListener(eligibilityChanged);
      dialog.remove();
    } });
  }
  const api = Object.freeze({ create, isEligible });
  scope.BlinklyRestDemo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
