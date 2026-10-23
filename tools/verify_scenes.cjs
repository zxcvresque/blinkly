/* Direct visual QA for Window & Mist; uses a disposable browser and no timer/audio flows. */
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.resolve(process.env.BLINKLY_EXTENSION_ROOT || path.join(__dirname, '..'));
const out = process.env.BLINKLY_SCENES_QA_DIR || '/private/tmp/blinkly-scenes-qa';
let context, profile;
(async () => {
  fs.mkdirSync(out, { recursive: true });
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'blinkly-scenes-browser-'));
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.BLINKLY_BROWSER || '/Applications/Helium.app/Contents/MacOS/Helium',
    headless: true, ignoreDefaultArgs: ['--disable-extensions'], viewport: { width: 1365, height: 900 },
    args: ['--disable-extensions-except=' + ROOT, '--load-extension=' + ROOT]
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(worker.url().replace('background.js', 'options.html'));
  await page.waitForFunction(() => globalThis.BlinklyScenes && document.getElementById('blinkly-root'));
  await page.evaluate(() => {
    document.getElementById('blinkly-root').style.display = 'none';
    window.__sceneQA = {};
    for (const [name, width, height, factory] of [['window', 332, 330, 'createWindow'], ['rest', 960, 600, 'createRest']]) {
      const canvas = document.createElement('canvas'); canvas.id = 'qa-' + name;
      canvas.style.cssText = `display:block;width:${width}px;height:${height}px;margin:0;`;
      document.body.appendChild(canvas); __sceneQA[name] = { canvas, scene: BlinklyScenes[factory](canvas) };
    }
  });
  const draw = (name, progress, accent = '#ef5b78') => page.evaluate(async ({ name, progress, accent }) => {
    const { canvas, scene } = __sceneQA[name]; scene.draw({ progress, accent, clock: 0, dt: 0 });
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const digest = await crypto.subtle.digest('SHA-256', data);
    let light = 0, count = 0, edge = 0, edgeCount = 0;
    for (let y = 0; y < canvas.height; y += 8) for (let x = 0; x < canvas.width; x += 8) {
      const i = (y * canvas.width + x) * 4, value = data[i] * .2126 + data[i + 1] * .7152 + data[i + 2] * .0722;
      light += value; count++;
      if (y > canvas.height * .85 && (x < canvas.width * .12 || x > canvas.width * .88)) { edge += value; edgeCount++; }
    }
    return { hash: [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join(''),
      brightness: light / count, treeEdgeBrightness: edge / edgeCount, width: canvas.width, height: canvas.height };
  }, { name, progress, accent });
  const windowFrames = [];
  for (const progress of [0, .5, 1]) windowFrames.push(await draw('window', progress));
  assert.equal(new Set(windowFrames.map(frame => frame.hash)).size, 3, 'Work progress moves the window light');
  const middleWindow = await draw('window', .5);
  assert.equal((await draw('window', .5)).hash, middleWindow.hash, 'Window is stable with a frozen motion clock');
  await page.locator('#qa-window').screenshot({ path: path.join(out, 'window-mid.png') });
  const restFrames = [];
  for (const [label, progress] of [['start', 0], ['middle', .5], ['end', 1]]) {
    const frame = await draw('rest', progress); restFrames.push(frame);
    assert.equal((await draw('rest', progress)).hash, frame.hash, 'Rest is stable with a frozen motion clock');
    await page.locator('#qa-rest').screenshot({ path: path.join(out, `rest-${label}.png`) });
  }
  assert.ok(restFrames[0].brightness < restFrames[1].brightness && restFrames[1].brightness < restFrames[2].brightness,
    'The mountain dawn brightens as the real break progresses');
  assert.equal(new Set(restFrames.map(frame => frame.hash)).size, 3);
  assert.ok(restFrames[2].treeEdgeBrightness < 35, 'Foreground tree edges stay dark');
  assert.notEqual((await draw('rest', .5, '#8fb4ff')).hash, restFrames[1].hash, 'Custom blue accent changes the rest palette');
  assert.notEqual((await draw('window', .5, '#8fb4ff')).hash, middleWindow.hash, 'Custom blue accent changes the window palette');
  const resized = await page.evaluate(() => {
    const result = {};
    for (const [name, width, height, cap] of [['window', 249, 247.5, 2], ['rest', 540, 360, 1.5]]) {
      const { canvas, scene } = __sceneQA[name]; canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
      scene.draw({ progress: .5, clock: 0, dt: 0 });
      const dpr = Math.min(cap, Math.max(1, devicePixelRatio || 1));
      result[name] = { width: canvas.width, height: canvas.height, expectedWidth: Math.round(width * dpr), expectedHeight: Math.round(height * dpr) };
      scene.destroy(); scene.destroy(); scene.draw({ progress: 1, clock: 0, dt: 0 });
    }
    return result;
  });
  for (const value of Object.values(resized)) { assert.equal(value.width, value.expectedWidth); assert.equal(value.height, value.expectedHeight); }
  assert.deepEqual(errors, []);
  const report = { root: ROOT, windowFrames, restFrames, resized, errors,
    checks: ['three work progress images', 'three brightening rest images', 'frozen-clock determinism', 'dark tree edges',
      'both custom accent palettes', 'CSS resizing and DPR', 'idempotent destroy and safe future draws'] };
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (context) await context.close();
  if (profile) fs.rmSync(profile, { recursive: true, force: true });
});
