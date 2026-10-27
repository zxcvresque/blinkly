/* Capture the real extension's countdown and Rested screens in a disposable profile. */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'design', 'previews');
let context, server, profile;

async function shadow(page) {
  const client = await context.newCDPSession(page);
  const { root } = await client.send('DOM.getDocument', { depth: -1, pierce: true });
  function find(node) {
    if (node.attributes?.includes('blinkly-root')) return node.shadowRoots?.[0];
    for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) {
      const match = find(child); if (match) return match;
    }
  }
  const node = find(root);
  assert.ok(node, 'The actual Blinkly content script must be injected');
  const { object } = await client.send('DOM.resolveNode', { nodeId: node.nodeId });
  return async fn => {
    const result = await client.send('Runtime.callFunctionOn', {
      objectId: object.objectId, functionDeclaration: fn.toString(),
      returnByValue: true, awaitPromise: true, userGesture: true
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
}

(async () => {
  fs.mkdirSync(OUTPUT, { recursive: true });
  server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html><head><title>Blinkly rest capture</title><style>body{margin:0;background:#14191c}</style></head><body><main> </main></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'blinkly-rest-capture-'));
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.BLINKLY_BROWSER || '/Applications/Helium.app/Contents/MacOS/Helium',
    headless: true, ignoreDefaultArgs: ['--disable-extensions'],
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    args: ['--disable-extensions-except=' + ROOT, '--load-extension=' + ROOT]
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ cfg: {
      accent: '#ef5b78', voiceOn: false, sound: false, sleepEnabled: false,
      widget: false, breakSec: 20, workMin: 20, mode: 'overlay'
    } });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForSelector('#blinkly-root', { state: 'attached' });
  await page.bringToFront();
  const ui = await shadow(page);
  await ui(function () { this.querySelector('[data-a="now"]').click(); });
  await page.waitForTimeout(200);
  // Advance the real shared timer to a representative middle-of-rest frame.
  await worker.evaluate(async () => {
    const { state } = await chrome.storage.local.get('state');
    const captureState = { ...state, phase: 'break', breakLen: 20,
      breakEnd: Date.now() + 16000, revision: state.revision + 1, w: 'rest-capture' };
    await chrome.storage.local.set({ state: captureState, timerState: captureState });
  });
  await page.waitForTimeout(2200);
  const activeUI = await shadow(page);
  const active = await activeUI(function () {
    // Freeze entrance transitions so screenshots always include the complete UI.
    const freeze = document.createElement('style');
    freeze.textContent = '*{animation:none!important;transition:none!important}';
    this.appendChild(freeze);
    return { on: this.querySelector('#ov').classList.contains('on'),
      number: this.querySelector('#num').textContent,
      title: this.querySelector('#ttl').textContent };
  });
  assert.equal(active.on, true);
  assert.match(active.number, /^\d+$/);
  await page.screenshot({ path: path.join(OUTPUT, 'rest-active.png') });
  // Finish through the extension's shared timer service, retaining its genuine completion UI.
  await worker.evaluate(async () => {
    const { state } = await chrome.storage.local.get('state');
    const captureState = { ...state, breakEnd: Date.now() - 1,
      revision: state.revision + 1, w: 'rest-complete-capture' };
    await chrome.storage.local.set({ state: captureState, timerState: captureState });
  });
  await page.waitForTimeout(1100);
  const completedUI = await shadow(page);
  const complete = await completedUI(function () {
    return { on: this.querySelector('#ov').classList.contains('on'),
      done: this.querySelector('#ov').classList.contains('done'),
      number: this.querySelector('#num').textContent,
      title: this.querySelector('#ttl').textContent };
  });
  assert.equal(complete.on, true); assert.equal(complete.done, true);
  assert.equal(complete.number, 'Rested');
  await page.screenshot({ path: path.join(OUTPUT, 'rest-complete.png') });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ width: 1440, height: 900, active, complete,
    files: ['design/previews/rest-active.png', 'design/previews/rest-complete.png'], errors }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (context) await context.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (profile) fs.rmSync(profile, { recursive: true, force: true });
});
