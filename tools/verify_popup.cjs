/* Popup layout QA in a disposable Helium profile. It never uses an existing browser session. */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.resolve(process.env.BLINKLY_EXTENSION_ROOT || path.join(__dirname, '..'));
const reportDir = process.env.BLINKLY_POPUP_QA_DIR || '/private/tmp/blinkly-popup-qa';
const ids = ['hero', 'window-scene', 't', 'l', 'b-now', 'b-pause', 'b-snooze', 's-d', 's-s', 's-a', 'b-set'];
let context, profile;
const errors = [];

function contrast(front, back) {
  const luminance = hex => {
    const rgb = hex.match(/[a-f\d]{2}/gi).map(n => parseInt(n, 16) / 255)
      .map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  const values = [luminance(front), luminance(back)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}

(async () => {
  fs.mkdirSync(reportDir, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json')));
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.match(manifest.name, /^Blinkly/);
  const source = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
  for (const id of ids) assert.equal((source.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id);
  for (const asset of ['popup.js', 'sleep-schedule.js', 'reminder-preferences.js', 'blinkly-scenes.js', 'icons/icon128.png', 'assets/blinkly-logo.png'])
    assert.ok(fs.existsSync(path.join(ROOT, asset)), asset);

  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'blinkly-popup-browser-'));
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.BLINKLY_BROWSER || '/Applications/Helium.app/Contents/MacOS/Helium',
    headless: true, ignoreDefaultArgs: ['--disable-extensions'], viewport: { width: 1365, height: 900 },
    args: ['--disable-extensions-except=' + ROOT, '--load-extension=' + ROOT]
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({
      state: { phase: 'work', elapsed: 0, paused: false, lastAct: Date.now(), days: {} }
    });
  });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    const requestFrame = globalThis.requestAnimationFrame.bind(globalThis);
    globalThis.requestAnimationFrame = callback => {
      globalThis.__popupRAFRequests = (globalThis.__popupRAFRequests || 0) + 1;
      return requestFrame(callback);
    };
    let scenes;
    Object.defineProperty(globalThis, 'BlinklyScenes', { configurable: true, get: () => scenes, set(value) {
      scenes = { ...value, createWindow(canvas) {
        const instance = value.createWindow(canvas);
        return { draw(frame) { globalThis.__popupSceneFrame = { ...frame };
          globalThis.__popupDraws = (globalThis.__popupDraws || 0) + 1; instance.draw(frame); },
          destroy() { globalThis.__popupSceneDestroyed = true; instance.destroy(); } };
      } };
    } });
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(worker.url().replace('background.js', 'popup.html'));
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#window-scene');
    return globalThis.BlinklyScenes && canvas.width > 0 && canvas.height > 0;
  });
  await page.locator('.brand img').evaluate(image => image.decode());
  for (const id of ids) assert.ok(await page.locator('#' + id).isVisible(), id + ' visible');

  const layout = await page.evaluate(() => {
    const body = document.body.getBoundingClientRect();
    const clipping = [...document.querySelectorAll('button,.stat,.c,.brand,canvas')]
      .map(element => ({ name: element.id || element.className,
        left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
        bottom: element.getBoundingClientRect().bottom }))
      .filter(box => box.left < body.left - 1 || box.right > body.right + 1 || box.bottom > body.bottom + 1);
    const image = document.querySelector('.brand img');
    return { width: body.width, height: body.height, scrollWidth: document.body.scrollWidth,
      clipping, imageLoaded: image.complete && image.naturalWidth === 128,
      font: getComputedStyle(document.querySelector('#t')).fontFamily,
      background: getComputedStyle(document.body,'::after').backgroundImage,
      scene: { width: document.querySelector('#window-scene').width, height: document.querySelector('#window-scene').height },
      countdown: { left: document.querySelector('.c').getBoundingClientRect().left - document.querySelector('#hero').getBoundingClientRect().left,
        bottom: document.querySelector('#hero').getBoundingClientRect().bottom - document.querySelector('.c').getBoundingClientRect().bottom } };
  });
  assert.equal(layout.width, 340);
  assert.ok(layout.height > 350 && layout.height < 600, 'Compact popup height');
  assert.ok(layout.scrollWidth <= 340, 'No horizontal overflow');
  assert.deepEqual(layout.clipping, []);
  assert.ok(layout.imageLoaded, 'Packaged brand icon loads');
  assert.doesNotMatch(layout.font, /Georgia|Palatino|Charter/);
  assert.match(layout.background, /linear-gradient/);
  assert.ok(layout.scene.width > 0 && layout.scene.height > 0, 'Window canvas is initialized');
  assert.ok(layout.countdown.left >= 16 && layout.countdown.left <= 22, 'Countdown sits in the lower-left window corner');
  assert.ok(layout.countdown.bottom >= 60 && layout.countdown.bottom <= 70);
  assert.equal(await page.locator('#dial,.tick').count(), 0, 'Old circular dial is removed');
  await page.screenshot({ path: path.join(reportDir, 'popup-desktop.png') });
  await page.locator('body').screenshot({ path: path.join(reportDir, 'popup.png') });
  assert.equal(await page.evaluate(() => globalThis.__popupSceneFrame.accent), '#ef5b78', 'Fresh installs use pinkish red');
  await worker.evaluate(async () => chrome.storage.local.set({ cfg: { accent: '#f4a259' } }));
  await page.waitForFunction(() => globalThis.__popupSceneFrame.accent === '#ef5b78');

  await worker.evaluate(async () => chrome.storage.local.set({
    cfg: { workMin: 20 }, state: { phase: 'work', elapsed: 600, paused: false, lastAct: Date.now(), days: {} }
  }));
  await page.waitForFunction(() => globalThis.__popupSceneFrame.progress === .5);
  const leafClock = await page.evaluate(() => globalThis.__popupSceneFrame.clock);
  await worker.evaluate(async () => chrome.storage.local.set({
    state: { phase: 'work', elapsed: 600, paused: true, lastAct: Date.now(), days: {} }
  }));
  await page.waitForFunction(() => document.querySelector('#b-pause').textContent === 'Resume');
  assert.equal(await page.evaluate(() => globalThis.__popupSceneFrame.progress), .5, 'Paused light holds saved work progress');
  await page.waitForFunction(previous => globalThis.__popupSceneFrame.clock > previous + .1, leafClock);
  await page.locator('#b-snooze').click();
  await page.waitForFunction(() => globalThis.__popupSceneFrame.progress === .75 && document.querySelector('#t').textContent === '5:00');
  assert.equal(await page.locator('#b-pause').textContent(), 'Resume', 'Paused snooze keeps timer paused');
  await worker.evaluate(async () => chrome.storage.local.set({
    state: { phase: 'work', elapsed: 600, paused: true, lastAct: Date.now(), days: {} }
  }));
  await page.waitForFunction(() => globalThis.__popupSceneFrame.progress === .5);
  await worker.evaluate(async () => chrome.storage.local.set({
    cfg: { quietEnabled: true, quietStart: '00:00', quietEnd: '00:00' },
    state: { phase: 'work', elapsed: 600, paused: false, lastAct: Date.now(), days: {} }
  }));
  await page.waitForFunction(() => document.querySelector('#l').textContent === 'Quiet hours');
  assert.equal(await page.evaluate(() => globalThis.__popupSceneFrame.progress), .5, 'Quiet hours hold window light');
  await worker.evaluate(async () => chrome.storage.local.set({
    cfg: { quietEnabled: false }, state: { phase: 'work', elapsed: 600, paused: false, lastAct: 0, days: {} }
  }));
  await page.waitForFunction(() => document.querySelector('#l').textContent === 'away, timer waiting');
  assert.equal(await page.evaluate(() => globalThis.__popupSceneFrame.progress), .5, 'Idle timer holds window light');
  await worker.evaluate(async () => chrome.storage.local.set({
    state: { phase: 'work', elapsed: 0, paused: true, lastAct: 0, days: {} }
  }));
  await page.waitForFunction(() => globalThis.__popupSceneFrame.progress === 0 && document.querySelector('#t').textContent === '20:00');
  await worker.evaluate(async () => {
    const bed = new Date(Date.now() + 120 * 60000).toISOString().slice(11, 16);
    await chrome.storage.local.set({ cfg: { workMin: 20, sleepEnabled: true, bedtime: bed,
      sleepLeadMin: 120, sleepMode: 'frequent', sleepWorkMin: 10, sleepTimezone: 'UTC' },
      state: { phase: 'work', elapsed: 300, paused: false, lastAct: Date.now(), days: {} } });
  });
  await page.waitForFunction(() => globalThis.__popupSceneFrame.progress === .5 && document.querySelector('#t').textContent === '5:00');
  await worker.evaluate(async () => chrome.storage.local.set({ cfg: {},
    state: { phase: 'work', elapsed: 0, paused: false, lastAct: Date.now(), days: {} } }));
  await page.waitForFunction(() => globalThis.__popupSceneFrame.progress === 0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => globalThis.__popupSceneFrame.clock === 0 && globalThis.__popupSceneFrame.dt === 0);
  const reduced = await page.evaluate(() => ({ requests: globalThis.__popupRAFRequests,
    draws: globalThis.__popupDraws, pixels: document.querySelector('#window-scene').toDataURL() }));
  await page.waitForFunction(draws => globalThis.__popupDraws >= draws + 2, reduced.draws, { polling: 100 });
  assert.equal(await page.evaluate(() => globalThis.__popupRAFRequests), reduced.requests, 'Reduced motion schedules no continuous animation frames');
  assert.equal(await page.evaluate(() => document.querySelector('#window-scene').toDataURL()), reduced.pixels, 'Reduced motion redraws remain pixel-stable');
  assert.deepEqual(await page.evaluate(() => [globalThis.__popupSceneFrame.clock, globalThis.__popupSceneFrame.dt]), [0, 0]);
  await page.locator('body').screenshot({ path: path.join(reportDir, 'popup-reduced-motion.png') });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() => globalThis.__popupSceneFrame.clock > .1);
  assert.ok(await page.evaluate(() => globalThis.__popupRAFRequests) > reduced.requests, 'Changing motion preference resumes animation');

  await page.locator('#b-set').focus();
  assert.ok(await page.locator('#b-set').evaluate(button => button === document.activeElement));
  await page.locator('#b-now').click();
  await page.waitForFunction(() => document.querySelector('#l').textContent === 'look 20 feet away');
  const breakState = await worker.evaluate(async () => (await chrome.storage.local.get('state')).state);
  assert.equal(breakState.phase, 'break');
  assert.equal(breakState.manualBreak, true);
  await page.locator('#b-pause').click();
  await page.waitForFunction(() => document.querySelector('#b-pause').textContent === 'Resume');
  await page.locator('#b-pause').click();
  await page.waitForFunction(() => document.querySelector('#b-pause').textContent === 'Pause');
  await page.locator('#b-snooze').click();
  await page.waitForFunction(() => document.querySelector('#l').textContent !== 'look 20 feet away');
  const snooze = await worker.evaluate(async () => (await chrome.storage.local.get('state')).state);
  assert.equal(snooze.phase, 'work');
  assert.ok(snooze.snoozeCount >= 1);

  await worker.evaluate(async () => chrome.storage.local.set({ cfg: { strict: true, accent: '#9ec9db' } }));
  await page.waitForFunction(() => document.querySelector('#b-snooze').hidden);
  assert.equal(await page.locator('#b-snooze').isVisible(), false);
  assert.equal(await page.locator('html').evaluate(element => getComputedStyle(element).getPropertyValue('--ac').trim()), '#9ec9db');
  assert.equal(await page.evaluate(() => globalThis.__popupSceneFrame.accent), '#9ec9db');
  await page.locator('body').screenshot({ path: path.join(reportDir, 'popup-strict-custom-accent.png') });
  await page.locator('#b-set').click();
  await page.waitForFunction(() => !document.querySelector('#settings-status').hidden);
  const guidanceLayout = await page.evaluate(() => ({
    height: document.body.getBoundingClientRect().height,
    messageBottom: document.querySelector('#settings-status').getBoundingClientRect().bottom,
    bodyBottom: document.body.getBoundingClientRect().bottom
  }));
  assert.ok(guidanceLayout.height < 600, 'Inline Settings guidance fits browser popup height');
  assert.ok(guidanceLayout.messageBottom <= guidanceLayout.bodyBottom, 'Settings guidance remains readable');
  await page.locator('body').screenshot({ path: path.join(reportDir, 'popup-settings-guidance.png') });
  assert.deepEqual(errors, [], 'No popup console errors');
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide')));
  assert.equal(await page.evaluate(() => globalThis.__popupSceneDestroyed), true, 'Window renderer cleans up on pagehide');
  const stoppedRequests = await page.evaluate(() => globalThis.__popupRAFRequests);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(await page.evaluate(() => globalThis.__popupRAFRequests), stoppedRequests, 'Destroyed scene no longer responds to preference changes');
  const contrasts = {
    bodyText: contrast('#f2f2f2', '#1d1d1d'), mutedText: contrast('#b8b8b8', '#272727'),
    primaryButton: contrast('#222222', '#ededed'), secondaryButton: contrast('#f2f2f2', '#272727')
  };
  for (const [name, value] of Object.entries(contrasts)) assert.ok(value >= 4.5, name + ' WCAG AA contrast');
  const report = { root: ROOT, browser: 'Helium', layout, contrasts, consoleErrors: errors,
    checks: ['11 stable visible IDs', '340px popup without overflow', 'brand icon loads',
      'settings accepts keyboard focus', 'break, pause, resume and snooze still work',
      'strict mode hides snooze', 'window-light canvas replaces circular dial', 'countdown stays inside the lower-left window area',
      'real effective timer progress drives light', 'pause, quiet hours and idle hold light while leaves move',
      'paused snooze and idle restart update scene to authoritative saved progress',
      'reduced motion is static with no continuous RAF and responds to preference changes',
      'pinkish red defaults replace legacy orange without changing saved custom colors',
      'saved custom accent reaches the animation', 'Settings failure guidance fits under 600px',
      'renderer destroys on pagehide', 'WCAG AA text contrast'] };
  fs.writeFileSync(path.join(reportDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; })
.finally(async () => {
  if (context) await context.close();
  if (profile) fs.rmSync(profile, { recursive: true, force: true });
});
