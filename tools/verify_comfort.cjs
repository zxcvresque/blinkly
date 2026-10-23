/* Live comfort checks. Launch only when no other browser QA is using focus. */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.resolve(__dirname, '..');
const reportDir = process.env.BLINKLY_COMFORT_QA_DIR || '/private/tmp/blinkly-comfort-qa';
let context, server, profile;
const errors = [], requests = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await wait(80); }
  throw new Error(`Timed out: ${label}`);
}
async function shadow(page) {
  const client = await context.newCDPSession(page);
  await client.send('DOM.enable');
  const { root } = await client.send('DOM.getDocument', { depth: -1, pierce: true });
  function search(node) {
    if (node.attributes?.includes('blinkly-root')) return node.shadowRoots?.[0];
    for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) {
      const found = search(child); if (found) return found;
    }
  }
  const node = search(root); assert.ok(node, 'Blinkly closed shadow root is injected');
  return async (fn, arg) => {
    const {root:currentRoot} = await client.send('DOM.getDocument', {depth:-1,pierce:true});
    const currentNode = search(currentRoot); assert.ok(currentNode, 'Live Blinkly shadow root');
    const { object } = await client.send('DOM.resolveNode', { backendNodeId: currentNode.backendNodeId });
    const result = await client.send('Runtime.callFunctionOn', {
      objectId: object.objectId, functionDeclaration: fn.toString(),
      arguments: [{ value: arg }], returnByValue: true, awaitPromise: true, userGesture: true
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
}
const near = (actual, expected, label, tolerance = 2) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `${label}: expected ${expected}, received ${actual}`);

(async () => {
  fs.mkdirSync(reportDir, { recursive: true });
  server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'none'; connect-src 'none'; media-src 'none'; style-src 'unsafe-inline'");
    res.end('<!doctype html><meta charset="utf-8"><title>Blinkly comfort check</title><style>body{margin:0;background:#fff;color:#222;font:16px system-ui}main{padding:70px;max-width:650px}p{line-height:1.8}</style><main><h1>A calmer screen</h1><p>This local page checks the actual injected controls, dragging, keyboard placement and immediate warm tint against a restrictive page policy.</p></main>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'blinkly-comfort-browser-'));
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.BLINKLY_BROWSER || '/Applications/Helium.app/Contents/MacOS/Helium',
    timezoneId: `Etc/GMT${12 - new Date().getUTCHours() > 0 ? '-' : '+'}${Math.abs(12 - new Date().getUTCHours())}`,
    headless: true, ignoreDefaultArgs: ['--disable-extensions'], viewport: { width: 1365, height: 900 },
    args: ['--disable-extensions-except=' + ROOT, '--load-extension=' + ROOT, '--autoplay-policy=no-user-gesture-required']
  });
  context.on('request', request => requests.push(request.url()));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  worker.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await worker.evaluate(() => chrome.storage.local.clear());
  const page = await context.newPage();
  const track = page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  };
  track(page);
  // A browser timezone override makes this local noon in every JavaScript world.
  await page.goto(url); await wait(250); await page.bringToFront();
  let ui = await shadow(page);
  const cfg = () => worker.evaluate(async () => (await chrome.storage.local.get('cfg')).cfg);
  const patch = value => worker.evaluate(async value => {
    const { cfg = {} } = await chrome.storage.local.get('cfg');
    await chrome.storage.local.set({ cfg: { ...cfg, ...value } });
  }, value);
  const state = () => ui(function () {
    const rect = element => { const b = element.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height, x: b.left + b.width / 2, y: b.top + b.height / 2 }; };
    const widget = this.querySelector('#w');
    const tint = [...this.ownerDocument.documentElement.children].find(element => element.style.zIndex === '2147483646');
    return { panel: this.querySelector('#panel').classList.contains('on'), dial: rect(widget.querySelector('.dial')),
      widget: rect(widget), label: rect(widget.querySelector('.lab')), left: widget.style.left, top: widget.style.top,
      tint: tint ? getComputedStyle(tint).backgroundColor : '', localHour: new Date().getHours() };
  });
  const point = selector => ui(function (selector) {
    const element = this.querySelector(selector); if (!element) throw new Error('Missing: ' + selector);
    const r = element.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  const click = async selector => { await wait(360); const p = await point(selector); await page.mouse.click(p.x, p.y); };
  const change = (selector, value) => ui(function ({ selector, value }) {
    const el = this.querySelector(selector); el.value = value; el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { selector, value });
  await patch({ voiceOn: false, sound: false, warm: 0, warmNight: true, warmNow: false, workMin: 60 });
  await wait(150);
  const initial = await state(); assert.equal(initial.localHour, 12);
  await click('.dial'); await until(async () => (await state()).panel, 'widget opens settings');
  await click('#tabs [data-t="smart"]');
  await change('[data-k="corner"]', 'custom');
  await until(async () => (await cfg()).corner === 'custom', 'custom placement saves');
  await click('[data-a="close"]'); await wait(400);
  assert.equal((await state()).panel, false);
  const from = (await state()).dial, target = { x: 300, y: 260 };
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 }); await page.mouse.up();
  await until(async () => Number.isFinite((await cfg()).widgetPosition?.x), 'drag coordinates save');
  await wait(600);
  const dragged = await state();
  assert.equal(dragged.panel, false, 'drag release never opens settings');
  near(dragged.dial.x, target.x, 'dragged dial x'); near(dragged.dial.y, target.y, 'dragged dial y');
  const savedPosition = (await cfg()).widgetPosition;
  assert.ok(savedPosition.x >= 0 && savedPosition.x <= 1 && savedPosition.y >= 0 && savedPosition.y <= 1);
  await page.screenshot({ path: path.join(reportDir, 'custom-drag.png') });
  await page.reload(); await wait(250); ui = await shadow(page);
  const refreshed = await state(); near(refreshed.dial.x, target.x, 'reload dial x'); near(refreshed.dial.y, target.y, 'reload dial y');
  assert.equal(refreshed.panel, false);
  const other = await context.newPage(); track(other); await other.goto(url + '/second'); await wait(250);
  const otherUI = await shadow(other);
  const second = await otherUI(function () { const r = this.querySelector('.dial').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  near(second.x, target.x, 'new tab dial x'); near(second.y, target.y, 'new tab dial y');
  await other.close(); await page.bringToFront();
  await page.setViewportSize({ width: 360, height: 780 }); await wait(200);
  let narrow = await state();
  assert.ok(narrow.dial.left >= 0 && narrow.dial.right <= 360 && narrow.dial.top >= 0 && narrow.dial.bottom <= 780);
  const anchor = narrow.dial;
  await page.mouse.move(anchor.x, anchor.y); await wait(650);
  const hovered = await state();
  near(hovered.dial.x, anchor.x, 'hover keeps dial x anchored'); near(hovered.dial.y, anchor.y, 'hover keeps dial y anchored');
  assert.ok(hovered.widget.left >= -1 && hovered.widget.right <= 361 && hovered.widget.top >= 0 && hovered.widget.bottom <= 780,
    `expanded widget fits: ${JSON.stringify(hovered.widget)}`);
  await page.screenshot({ path: path.join(reportDir, 'custom-narrow-hover.png') });
  await ui(function () { this.querySelector('#w').focus(); });
  const beforeKeys = (await state()).dial;
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown');
  await wait(150); const afterKeys = (await state()).dial;
  near(afterKeys.x, beforeKeys.x + 10, 'keyboard moves x'); near(afterKeys.y, beforeKeys.y + 10, 'keyboard moves y');
  assert.notDeepEqual((await cfg()).widgetPosition, savedPosition);
  await page.keyboard.press('Enter'); await until(async () => (await state()).panel, 'keyboard Enter opens settings');
  await click('#tabs [data-t="smart"]'); await change('[data-k="corner"]', 'tl');
  await until(async () => (await cfg()).corner === 'tl', 'preset saves');
  const preset = await state(); assert.equal(preset.left, ''); assert.equal(preset.top, '');
  await page.setViewportSize({ width: 1365, height: 900 });
  await click('#tabs [data-t="comfort"]'); await wait(150);
  await until(async () => (await state()).tint === 'rgba(0, 0, 0, 0)', 'night-only tint is clear at noon');
  await click('[data-k="warmNow"]');
  await until(async () => (await cfg()).warmNow === true && (await cfg()).warm === 15, 'Tint now saves and seeds strength');
  await until(async () => /rgba\(255, 140, 40, 0\.(?:1[01]|12)/.test((await state()).tint), 'Tint now becomes visibly warm');
  assert.equal((await cfg()).warmNight, true, 'immediate override preserves night schedule');
  const tintOn = await state();
  await page.screenshot({ path: path.join(reportDir, 'tint-panel.png') });
  await page.reload(); await wait(250); ui = await shadow(page);
  assert.equal((await cfg()).warmNow, true); await until(async () => (await state()).tint !== 'rgba(0, 0, 0, 0)', 'Tint now survives reload');
  await click('.dial'); await until(async () => (await state()).panel, 'open restored controls');
  await click('#tabs [data-t="comfort"]');
  await click('[data-k="warmNow"]');
  await until(async () => (await cfg()).warmNow === false, 'Tint now switches off');
  await until(async () => (await state()).tint === 'rgba(0, 0, 0, 0)', 'daytime night schedule returns to clear');
  assert.equal((await cfg()).warmNight, true);
  await click('[data-k="warmNight"]');
  await until(async () => (await cfg()).warmNight === false, 'night schedule switches off');
  await click('[data-k="warmNow"]'); await until(async () => (await cfg()).warmNow === true, 'immediate tint works without schedule');
  await until(async () => (await state()).tint !== 'rgba(0, 0, 0, 0)', 'immediate tint visible without schedule');
  await click('[data-k="warmNow"]'); await until(async () => (await cfg()).warmNow === false, 'immediate tint disables without schedule');
  await until(async () => (await state()).tint === 'rgba(0, 0, 0, 0)', 'both disabled is clear');
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(requests.filter(url => url.includes('api.elevenlabs.io')).length, 0);
  const report = { browser: 'Helium', customDrag: { target, savedPosition, dragged, refreshed, second, hovered, afterKeys },
    tintOn, finalConfig: await cfg(), consoleErrors: errors, elevenLabsRequests: 0,
    checks: ['real mouse drag stays closed and saves', 'dial follows requested point', 'position restores after reload and in new tab',
      '360px viewport and hover expansion stay visible', 'keyboard moves and saves', 'preset clears custom inline position',
      'Tint now overrides noon night schedule and initializes strength', 'immediate tint persists reload', 'Tint now off resumes schedule', 'both tint toggles off is clear'] };
  fs.writeFileSync(path.join(reportDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; })
.finally(async () => {
  if (context) await context.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (profile) fs.rmSync(profile, { recursive: true, force: true });
});
