/* Landing rest preview QA in an isolated browser. No installed extension or user profile. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ROOT = path.resolve(__dirname, '..');
const out = process.env.BLINKLY_LANDING_QA_DIR || '/private/tmp/blinkly-landing-rest-qa';
let browser, server;
const report = { checks: [], layouts: [], errors: [] };

async function localURL() {
  if (process.env.BLINKLY_LANDING_URL) return process.env.BLINKLY_LANDING_URL;
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.json': 'application/json' };
  server = http.createServer((req, res) => {
    const target = path.resolve(ROOT, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!target.startsWith(ROOT + path.sep) && target !== ROOT) { res.writeHead(403).end(); return; }
    const file = target === ROOT ? path.join(ROOT, 'index.html') : target;
    let stat;
    try { stat = fs.statSync(file); } catch { res.writeHead(404).end(); return; }
    if (!stat.isFile()) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const start = range ? Number(range[1]) : 0, end = range && range[2] ? Number(range[2]) : stat.size - 1;
    if (start > end || end >= stat.size) { res.writeHead(416).end(); return; }
    res.setHeader('Content-Length', end - start + 1);
    if (range) res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${stat.size}` });
    fs.createReadStream(file, { start, end }).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}/`;
}

async function openPage(url, viewport, reducedMotion = 'no-preference', options = {}) {
  const { navigatorOverrides, ...contextOptions } = options;
  const context = await browser.newContext({ viewport, reducedMotion, ...contextOptions });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.clock.install();
  await page.addInitScript(() => {
    window.__restQA = { scenes: [], sampleStops: 0 };
    for (const name of ['BlinklyScenes', 'BlinklySamples', 'BlinklyRestDemo', 'BlinklyScrollPreview']) {
      let value;
      Object.defineProperty(window, name, { configurable: true, get: () => value, set(api) {
        if (name === 'BlinklyScenes') value = { ...api, createRest(canvas) {
          const scene = api.createRest(canvas), record = { draws: 0, destroyed: false };
          __restQA.scenes.push(record);
          return { draw(frame) { record.draws++; record.frame = { ...frame }; scene.draw(frame); },
            destroy() { record.destroyed = true; scene.destroy(); } };
        } };
        else if (name === 'BlinklySamples') value = { ...api, createPlayer(options) {
          const player = api.createPlayer(options);
          return { ...player, stop() { __restQA.sampleStops++; return player.stop(); } };
        } };
        else if (name === 'BlinklyRestDemo') value = { ...api, create(options) {
          const demo = api.create(options); __restQA.demo = demo; return demo;
        } };
        else value = { ...api, create(options) {
          const scroll = api.create(options); __restQA.scroll = scroll; return scroll;
        } };
      } });
    }
  });
  if (navigatorOverrides) await page.addInitScript(values => {
    for (const [name, value] of Object.entries(values)) Object.defineProperty(navigator, name, { configurable: true, get: () => value });
  }, navigatorOverrides);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.BlinklyRestDemo && document.querySelector('#try-rest'));
  for (const id of ['#s0', '#s1', '#s2']) await page.locator(id).evaluate(image => image.decode());
  return { page, context };
}

async function layout(page, label) {
  const value = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
    documentWidth: document.documentElement.scrollWidth,
    dialogs: [...document.querySelectorAll('.blinkly-rest-demo[open]')].map(dialog => {
      const r = dialog.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width,
        scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth,
        visibleButtons: [...dialog.querySelectorAll('button')].filter(button => {
          const style = getComputedStyle(button); return style.display !== 'none' && style.visibility !== 'hidden';
        }).map(button => { const box = button.getBoundingClientRect(); return { text: button.textContent.trim(),
          left: box.left, right: box.right, top: box.top, bottom: box.bottom }; }) };
    }) }));
  assert.ok(value.documentWidth <= value.width + 1, label + ': no page horizontal overflow');
  for (const dialog of value.dialogs) {
    assert.ok(dialog.left >= -1 && dialog.right <= value.width + 1, label + ': dialog fits viewport width');
    assert.ok(dialog.top >= -1 && dialog.bottom <= value.height + 1, label + ': dialog fits viewport height');
    assert.ok(dialog.scrollWidth <= dialog.clientWidth + 1, label + ': no dialog horizontal overflow');
    for (const button of dialog.visibleButtons) {
      assert.ok(button.left >= -1 && button.right <= value.width + 1, label + ': button horizontal fit: ' + button.text);
      assert.ok(button.top >= -1 && button.bottom <= value.height + 1, label + ': button vertical fit: ' + button.text);
    }
  }
  report.layouts.push({ label, ...value });
}

async function runDemo(page, label) {
  const trigger = page.locator('#try-rest'), dialog = page.locator('.blinkly-rest-demo');
  const sampleStops = await page.evaluate(() => __restQA.sampleStops);
  await trigger.click();
  await page.waitForFunction(() => document.querySelector('.blinkly-rest-demo')?.dataset.state === 'running');
  assert.equal(await dialog.getAttribute('open'), '', label + ': demo opens as native dialog');
  assert.equal((await dialog.locator('[data-rest-num]').textContent()).trim(), '20');
  assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)), label + ': focus moves inside dialog');
  assert.ok(await page.locator('#vid').evaluate(video => video.paused), label + ': video pauses for rest');
  assert.ok(await page.evaluate(previous => __restQA.sampleStops > previous, sampleStops), label + ': rest stops voice samples');
  assert.ok(await page.evaluate(() => __restQA.scenes.some(scene => !scene.destroyed && scene.draws > 0)), label + ': actual rest renderer is active');
  if (label === 'reduced') {
    const still = await page.evaluate(() => __restQA.scenes.at(-1));
    assert.equal(still.frame.clock, 0, 'Reduced motion freezes scene clock');
    assert.equal(still.frame.dt, 0, 'Reduced motion freezes scene delta');
    await page.clock.fastForward(100);
    assert.equal(await page.evaluate(() => __restQA.scenes.at(-1).draws), still.draws,
      'Reduced motion schedules no continuous animation frames');
  }
  await layout(page, label + '-running');
  await page.screenshot({ path: path.join(out, label + '-running.png') });
  await page.clock.fastForward(1100);
  const countdown = Number((await dialog.locator('[data-rest-num]').textContent()).trim());
  assert.ok(countdown < 20 && countdown >= 18, label + ': real countdown advances');
  if (label === 'reduced') assert.deepEqual(await page.evaluate(() => {
    const frame = __restQA.scenes.at(-1).frame; return [frame.clock, frame.dt];
  }), [0, 0], 'Reduced motion stays frozen as the countdown updates');
  await page.clock.fastForward(20000);
  await page.waitForFunction(() => document.querySelector('.blinkly-rest-demo')?.dataset.state === 'rested');
  assert.equal((await dialog.locator('[data-rest-num]').textContent()).trim(), 'Rested');
  assert.match(await dialog.locator('[data-rest-title]').textContent(), /eyes thank you/i);
  assert.ok(await dialog.locator('[data-rest-return]').isVisible(), label + ': completion has return action');
  await layout(page, label + '-complete');
  await page.screenshot({ path: path.join(out, label + '-complete.png') });
  await dialog.locator('[data-rest-replay]').click();
  await page.waitForFunction(() => document.querySelector('.blinkly-rest-demo')?.dataset.state === 'running');
  assert.equal((await dialog.locator('[data-rest-num]').textContent()).trim(), '20', label + ': replay restarts timer');
  await page.keyboard.press('Escape');
  assert.equal(await dialog.isVisible(), false, label + ': Escape closes demo');
  assert.ok(await trigger.evaluate(el => document.activeElement === el), label + ': focus restores to trigger');
  await trigger.click();
  assert.equal((await dialog.locator('[data-rest-num]').textContent()).trim(), '20', label + ': reopen starts fresh');
  await dialog.locator('[data-rest-close]').click();
  assert.equal(await dialog.isVisible(), false, label + ': close action works');
  const closedScene = await page.evaluate(() => __restQA.scenes.at(-1));
  assert.equal(closedScene.destroyed, true, label + ': scene is destroyed on close');
  await page.clock.fastForward(25000);
  assert.equal(await dialog.isVisible(), false, label + ': old timer cannot reopen closed demo');
  assert.equal(await page.evaluate(() => __restQA.scenes.at(-1).draws), closedScene.draws, label + ': closed scene schedules no more draws');
  await page.evaluate(() => {
    const trigger = document.querySelector('#try-rest');
    trigger.click(); document.querySelector('[data-rest-close]').click(); trigger.click();
  });
  await page.clock.fastForward(100);
  assert.equal(await dialog.isVisible(), true, label + ': rapid close and reopen stays visible');
  assert.equal(await dialog.getAttribute('data-state'), 'running', label + ': queued close cannot stop a new rest');
  await page.clock.fastForward(21000);
  await dialog.locator('[data-rest-return]').click();
  assert.equal(await dialog.isVisible(), false, label + ': return action closes completed rest');
  report.checks.push(label + ': countdown, Rested, replay, Escape, focus restore, close, fresh reopen, timer cleanup');
}

async function captureScroll(page, label, progress, activeID) {
  await page.locator('#scene').evaluate((section, p) => {
    document.documentElement.style.scrollBehavior = 'auto';
    scrollTo(0, section.offsetTop + (section.offsetHeight - innerHeight) * p);
    dispatchEvent(new Event('scroll'));
  }, progress);
  await page.waitForFunction(id => Number(getComputedStyle(document.querySelector(id)).opacity) > .99, activeID);
  const boxes = await page.evaluate(id => {
    const rect = selector => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
    const caption = id === '#s0' ? '#c0' : id === '#s2' ? '#c2' : '#c1';
    return { captionTitle: rect(caption + ' h3'), captionText: rect(caption + ' p'),
      trigger: rect(document.querySelector('#try-rest').hidden ? '#rest-try p' : '#try-rest'),
      frame: rect('#scene .frame'), height: innerHeight };
  }, activeID);
  assert.ok(boxes.captionTitle.bottom <= boxes.captionText.top + 1, label + ': caption heading and body do not overlap');
  assert.ok(boxes.captionText.bottom <= boxes.trigger.top - 4, label + ': caption does not overlap try button');
  assert.ok(boxes.frame.top >= -1 && boxes.frame.bottom <= boxes.captionTitle.top + 1, label + ': screenshot fits above caption');
  assert.ok(boxes.trigger.bottom <= boxes.height, label + ': try button is in viewport');
  await layout(page, label);
  await page.screenshot({ path: path.join(out, label + '.png') });
}

async function scrub(page, time) {
  const progress = .3 + .58 * (time / 20);
  await page.locator('#scene').evaluate((section, p) => {
    document.documentElement.style.scrollBehavior = 'auto';
    scrollTo(0, section.offsetTop + (section.offsetHeight - innerHeight) * p);
    dispatchEvent(new Event('scroll'));
  }, progress);
  await page.waitForFunction(expected => {
    const canvas = document.querySelector('#rest-sequence-canvas');
    return canvas.dataset.ready === 'true' && Math.abs(Number(canvas.dataset.progress) - expected) < .002
      && Number(getComputedStyle(document.querySelector('#rest-sequence')).opacity) > .99;
  }, time / 20);
  const requestedFrame = await page.locator('#rest-sequence-canvas').getAttribute('data-frame-index');
  assert.equal(Number(requestedFrame), Math.round(time * 2), 'Scroll chooses its requested half-second frame');
  assert.equal(await page.locator('#rest-sequence-canvas').evaluate(canvas => {
    const box = canvas.getBoundingClientRect();
    const painted = element => {
      for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (Number(style.opacity) === 0 || style.visibility === 'hidden') return false;
      }
      return true;
    };
    return document.elementsFromPoint(box.left + box.width / 2, box.top + box.height / 2).find(painted) === canvas;
  }), true, 'Decoded sequence is visible above its fallback poster');
  return createHash('sha256').update(await page.locator('#rest-sequence-canvas').screenshot()).digest('hex');
}

async function verifyScrubbing(page, label) {
  const manifest = await page.evaluate(() => BlinklyRestFrames);
  assert.equal(manifest.frames.length, 41, label + ': includes every second and half second');
  assert.equal(manifest.duration, 20);
  assert.equal(manifest.step, .5);
  assert.deepEqual(manifest.frames.map(frame => frame.time), Array.from({ length: 41 }, (_, i) => i / 2));
  const captures = manifest.frames.map(frame => {
    const file = path.resolve(ROOT, frame.src);
    assert.ok(file.startsWith(ROOT + path.sep), 'Sequence assets are project-local');
    const bytes = fs.readFileSync(file);
    assert.ok(bytes.length > 1000, 'Captured frame contains image data');
    return createHash('sha256').update(bytes).digest('hex');
  });
  assert.equal(new Set(captures).size, 41, label + ': all half-second captures differ');
  const hashes = [];
  for (const time of [0, .5, 1, 5, 10, 15, 19.5]) hashes.push(await scrub(page, time));
  assert.equal(new Set(hashes).size, hashes.length, label + ': distinct frames appear as scrolling advances');
  const reversed = await scrub(page, 5);
  assert.equal(reversed, hashes[3], label + ': reverse scroll returns to the same animation frame');
  await page.clock.fastForward(5000);
  const held = createHash('sha256').update(await page.locator('#rest-sequence-canvas').screenshot()).digest('hex');
  assert.equal(held, reversed, label + ': animation holds when scrolling stops');
  await captureScroll(page, label + '-popup', .05, '#s0');
  await scrub(page, 10);
  await captureScroll(page, label + '-rest-middle', .59, '#rest-sequence');
  await captureScroll(page, label + '-rested', .96, '#s2');
  report.checks.push(label + ': restored popup, 41 half-second frames, forward/reverse scrub, holds without autoplay, final Rested');
}

async function blockedDemo(page, label) {
  assert.equal(await page.locator('#try-rest').isVisible(), false, label + ': trial button is hidden');
  assert.match(await page.locator('#rest-try p').textContent(), /computer in landscape/i,
    label + ': computer-only guidance is shown');
  const state = await page.evaluate(() => {
    const before = __restQA.scenes.length;
    document.querySelector('#try-rest').click();
    __restQA.demo.open();
    return { open: document.querySelectorAll('.blinkly-rest-demo[open]').length,
      before, after: __restQA.scenes.length };
  });
  assert.equal(state.open, 0, label + ': hidden click and programmatic open are blocked');
  assert.equal(state.after, state.before, label + ': blocked trial allocates no scene');
  report.checks.push(label + ': hidden trial, computer guidance, programmatic open prevented');
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const url = await localURL();
  browser = await chromium.launch({ executablePath: process.env.BLINKLY_BROWSER || '/Applications/Helium.app/Contents/MacOS/Helium', headless: true });
  const desktop = await openPage(url, { width: 1440, height: 1000 });
  const { page } = desktop;
  const images = await page.locator('#scene img').evaluateAll(images => images.map(image => ({
    src: image.getAttribute('src'), width: image.naturalWidth, height: image.naturalHeight, alt: image.alt })));
  assert.equal(images.length, 3, 'The original popup and both rest stills remain available');
  assert.match(images[0].src, /popup\.png$/);
  assert.match(images[1].src, /rest-active\.png$/);
  assert.match(images[2].src, /rest-complete\.png$/);
  assert.ok(images[0].width >= 300 && images[0].height >= 500, 'Original compact popup restored');
  images.slice(1).forEach(image => { assert.ok(image.width >= 1200 && image.height >= 750, 'Full rest window screenshot'); });
  images.forEach(image => assert.ok(image.alt));
  await verifyScrubbing(page, 'desktop');
  await runDemo(page, 'desktop');
  await page.locator('#try-rest').click();
  await page.setViewportSize({ width: 1000, height: 1440 });
  await page.waitForFunction(() => !document.querySelector('.blinkly-rest-demo').open && document.querySelector('#try-rest').hidden);
  assert.ok(await page.evaluate(() => __restQA.scenes.at(-1).destroyed), 'Rotating desktop portrait closes and destroys trial');
  await blockedDemo(page, 'rotated-desktop-portrait');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForFunction(() => !document.querySelector('#try-rest').hidden);
  await page.locator('#try-rest').click();
  assert.equal(await page.locator('.blinkly-rest-demo').getAttribute('data-state'), 'running', 'Restoring desktop landscape allows trial again');
  await page.locator('[data-rest-close]').click();
  report.checks.push('Desktop rotation closes trial, releases scene, and allows reopening in landscape');
  await desktop.context.close();

  const reduced = await openPage(url, { width: 1440, height: 1000 }, 'reduce');
  assert.ok(await reduced.page.locator('body').evaluate(body => body.classList.contains('rm')));
  for (const id of ['#s0', '#s1', '#s2']) assert.equal(await reduced.page.locator(id).evaluate(el => Number(getComputedStyle(el).opacity)), 1);
  assert.equal(await reduced.page.locator('#rest-sequence-canvas').isVisible(), false, 'Reduced motion hides the scroll sequence');
  report.checks.push('Reduced motion shows original popup and both rest stills without animation');
  await runDemo(reduced.page, 'reduced');
  await reduced.context.close();

  const iphoneUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const ipadUA = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  for (const [label, viewport, options] of [
    ['mobile', { width: 390, height: 844 }, { hasTouch: true, isMobile: true }],
    ['mobile-landscape', { width: 844, height: 390 }, { hasTouch: true, isMobile: true }],
    ['iphone-wide-landscape', { width: 1280, height: 720 }, { userAgent: iphoneUA, hasTouch: true, isMobile: true }],
    ['tablet-wide-landscape', { width: 1440, height: 900 }, { userAgent: ipadUA, hasTouch: true }],
    ['mobile-UA-fine-pointer', { width: 1440, height: 900 }, { userAgent: iphoneUA }],
    ['ipadOS-desktop-UA', { width: 1440, height: 900 }, { hasTouch: true, navigatorOverrides: { platform: 'MacIntel', maxTouchPoints: 5 } }],
    ['desktop-portrait', { width: 1000, height: 1440 }, {}]
  ]) {
    const session = await openPage(url, viewport, 'no-preference', options);
    await blockedDemo(session.page, label);
    await captureScroll(session.page, label + '-scroll-popup', .05, '#s0');
    await captureScroll(session.page, label + '-scroll-active', .59, '#rest-sequence');
    await captureScroll(session.page, label + '-scroll-complete', .96, '#s2');
    await session.context.close();
  }
  const localFile = await openPage(pathToFileURL(path.join(ROOT, 'index.html')).href, { width: 1440, height: 1000 });
  await verifyScrubbing(localFile.page, 'local-file');
  await localFile.context.close();
  assert.deepEqual(report.errors, [], 'No uncaught page errors');
  report.url = url;
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ checks: report.checks, layoutsChecked: report.layouts.length,
    errors: report.errors, report: path.join(out, 'report.json') }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
