/* Capture the unchanged extension UI at every half second using its GM storage adapter. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const sharp = require(process.env.SHARP_MODULE || 'sharp');
const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'design', 'previews', 'rest-sequence');
const WIDTH = 1440, HEIGHT = 900, DURATION = 20, STEP = .5;
let browser, server;

(async () => {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'))).content_scripts[0].js;
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>Blinkly rest frame capture</title>' +
    '<style>body{margin:0;background:#14191c}</style></head><body>' +
    scripts.map(file => `<script src="/${file}"></script>`).join('') + '</body></html>';
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
    const file = path.resolve(ROOT, '.' + decodeURIComponent(pathname));
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({
    executablePath: process.env.BLINKLY_BROWSER || '/Applications/Helium.app/Contents/MacOS/Helium',
    headless: true
  });
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const base = 1793127600000;
    let now = base, handle = 0;
    const raf = new Map(), listeners = new Map();
    const cfg = { accent: '#ef5b78', voiceOn: false, sound: false, sleepEnabled: false,
      widget: false, breakSec: 20, workMin: 20, mode: 'overlay' };
    const state = { phase: 'work', elapsed: 0, paused: false, lastAct: base, days: {} };
    Date.now = () => now;
    let randomState = 123456789;
    Math.random = () => ((randomState = (1664525 * randomState + 1013904223) >>> 0) / 4294967296);
    const originalAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) {
      const root = originalAttachShadow.call(this, options);
      if (this.id === 'blinkly-root') window.__captureShadow = root;
      return root;
    };
    window.GM_getValue = (key, fallback) => ({ cfg, state })[key] ?? fallback;
    window.GM_setValue = () => {};
    window.GM_addValueChangeListener = (key, callback) => {
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(callback);
    };
    window.GM_registerMenuCommand = () => {};
    window.GM_deleteValue = () => {};
    window.requestAnimationFrame = callback => { raf.set(++handle, callback); return handle; };
    window.cancelAnimationFrame = id => raf.delete(id);
    // UI updates are driven explicitly below; no live interval may race a snapshot.
    window.setInterval = () => ++handle;
    window.clearInterval = () => {};
    window.__captureAt = time => {
      now = base + time * 1000;
      const complete = time >= 20;
      const next = { ...state, phase: complete ? 'work' : 'break',
        breakEnd: base + 20000, breakLen: 20, manualBreak: true,
        res: complete ? 'done' : '', resAt: complete ? now : 0,
        resUntil: complete ? now + 3400 : 0, w: 'sequence-capture' };
      for (const callback of listeners.get('state') || []) callback('state', state, next, true);
      const pending = [...raf.values()]; raf.clear();
      pending.forEach(callback => callback(time * 1000));
      const root = window.__captureShadow;
      return { number: root.querySelector('#num').textContent,
        title: root.querySelector('#ttl').textContent,
        subtitle: root.querySelector('#sub').textContent,
        active: root.querySelector('#ov').classList.contains('on'),
        done: root.querySelector('#ov').classList.contains('done') };
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__captureShadow?.querySelector('#ov'));
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '*{animation:none!important;transition:none!important}';
    window.__captureShadow.appendChild(style);
  });
  const frames = [], states = [];
  for (let index = 0; index <= DURATION / STEP; index++) {
    const time = index * STEP;
    const state = await page.evaluate(time => window.__captureAt(time), time);
    assert.equal(state.active, true, 'Rest window remains visible');
    assert.equal(state.number, time === DURATION ? 'Rested' : String(Math.ceil(DURATION - time)));
    assert.equal(state.done, time === DURATION);
    const name = `frame-${String(index).padStart(3, '0')}.webp`;
    const pixels = await page.screenshot();
    const encoded = await sharp(pixels).webp({ quality: 80, effort: 5 }).toBuffer();
    fs.writeFileSync(path.join(OUTPUT, name), encoded);
    frames.push({ time, src: 'design/previews/rest-sequence/' + name });
    states.push({ time, ...state, bytes: encoded.length });
  }
  assert.equal(frames.length, 41);
  assert.equal(new Set(states.slice(0, -1).map(state => state.title)).size, 4);
  assert.equal(states.at(-1).title, 'Your eyes thank you.');
  assert.deepEqual(errors, []);
  const manifest = { width: WIDTH, height: HEIGHT, duration: DURATION, step: STEP, frames };
  fs.writeFileSync(path.join(OUTPUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(OUTPUT, 'manifest.js'), 'window.BlinklyRestFrames=' + JSON.stringify(manifest) + ';\n');
  const report = { width: WIDTH, height: HEIGHT, count: frames.length,
    bytes: states.reduce((total, frame) => total + frame.bytes, 0), states, errors };
  fs.writeFileSync(path.join(OUTPUT, 'capture-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ count: frames.length, bytes: report.bytes, first: states[0], middle: states[20], last: states.at(-1), errors }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
