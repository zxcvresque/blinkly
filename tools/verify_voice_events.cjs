/* Live cadence/reaction QA. Launch only when no other browser test needs focus. */
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.resolve(process.env.BLINKLY_EXTENSION_ROOT || path.join(__dirname, '..'));
const out = process.env.BLINKLY_VOICE_EVENTS_QA_DIR || '/private/tmp/blinkly-voice-events-qa';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let context, profile, server;
const errors = [], requests = [];
async function until(check, label, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await wait(90); }
  throw new Error('Timed out: ' + label);
}
async function shadow(page) {
  const client = await context.newCDPSession(page), contexts = [];
  client.on('Runtime.executionContextCreated', ({ context }) => contexts.push(context));
  await client.send('Runtime.enable'); await client.send('DOM.enable');
  const find = node => node.attributes?.includes('blinkly-root') ? node.shadowRoots?.[0]
    : [...(node.children || []), ...(node.shadowRoots || [])].map(find).find(Boolean);
  const node = find((await client.send('DOM.getDocument', { depth: -1, pierce: true })).root);
  assert.ok(node, 'Closed Blinkly root is injected');
  let world;
  for (const candidate of contexts) {
    const probe = await client.send('Runtime.evaluate', { contextId: candidate.id,
      expression: 'typeof BlinklyVoice === "object" && typeof BlinklyPreferences === "object"', returnByValue: true });
    if (probe.result.value) { world = candidate.id; break; }
  }
  assert.ok(world, 'Extension isolated world is available for audio instrumentation');
  const ui = async (fn, arg) => {
    const live = find((await client.send('DOM.getDocument', { depth: -1, pierce: true })).root);
    const { object } = await client.send('DOM.resolveNode', { backendNodeId: live.backendNodeId, executionContextId: world });
    const response = await client.send('Runtime.callFunctionOn', { objectId: object.objectId,
      functionDeclaration: fn.toString(), arguments: [{ value: arg }], returnByValue: true, awaitPromise: true, userGesture: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  await ui(function () {
    if (globalThis.__voiceEventQA) return;
    const root = this, active = new Set(), original = AudioBufferSourceNode.prototype.start;
    const qa = globalThis.__voiceEventQA = { starts: [], maxActive: 0 };
    AudioBufferSourceNode.prototype.start = function (...args) {
      active.add(this); qa.maxActive = Math.max(qa.maxActive, active.size);
      qa.starts.push({ at: Date.now(), duration: this.buffer?.duration, active: active.size,
        completionVisible: root.querySelector('#ov').matches('.on.done'),
        number: root.querySelector('#num').textContent,
        toast: root.querySelector('#toast').className, title: root.querySelector('#tt').textContent });
      this.addEventListener('ended', () => active.delete(this), { once: true });
      return original.apply(this, args);
    };
  });
  return ui;
}
(async () => {
  fs.mkdirSync(out, { recursive: true });
  server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'none'; connect-src 'none'; media-src 'none'; style-src 'unsafe-inline'");
    res.end('<!doctype html><title>Voice event check</title><h1>Local voice event check</h1>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'blinkly-voice-events-'));
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.BLINKLY_BROWSER || '/Applications/Helium.app/Contents/MacOS/Helium', headless: true,
    ignoreDefaultArgs: ['--disable-extensions'], viewport: { width: 1365, height: 900 },
    args: ['--disable-extensions-except=' + ROOT, '--load-extension=' + ROOT, '--autoplay-policy=no-user-gesture-required']
  });
  context.on('request', request => requests.push(request.url()));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {
    await chrome.storage.local.clear(); globalThis.__voiceSelections = []; globalThis.__voiceRequests = [];
    const select = selectClip, audio = bundledAudio;
    selectClip = async (message, sender) => {
      const result = await select(message, sender);
      if (result.key) __voiceSelections.push({ at: Date.now(), group: message.group, key: result.key,
        actionId: message.actionId, sessionId: message.sessionId, tab: sender.tab?.id });
      return result;
    };
    bundledAudio = async key => { __voiceRequests.push({ at: Date.now(), key }); return audio(key); };
    await chrome.storage.local.set({ cfg: { workMin: 60, breakSec: 20, warnSec: 0, idleMin: 10,
      sound: false, voiceOn: true, voiceDone: true, voiceSnooze: true, restGuidance: 'balanced',
      sleepEnabled: false, factsEvery: 0, flirty: false, mutedClips: [], favoriteClips: [] } });
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(url); await wait(250);
  const other = await context.newPage(); await other.goto(url + '/second'); await wait(200);
  const otherUI = await shadow(other); await page.bringToFront(); await page.mouse.click(180, 100);
  const ui = await shadow(page);
  const click = selector => ui(function (selector) { this.querySelector(selector).click(); }, selector);
  const selections = () => worker.evaluate(() => __voiceSelections);
  const audio = () => ui(function () { return globalThis.__voiceEventQA; });
  const patch = value => worker.evaluate(async value => {
    const { cfg = {} } = await chrome.storage.local.get('cfg'); await chrome.storage.local.set({ cfg: { ...cfg, ...value } });
  }, value);
  const tail = async before => (await selections()).slice(before);
  const start = async () => { await click('[data-a="now"]'); };
  const initial = (await selections()).length;
  await start();
  await until(async () => (await tail(initial)).some(item => item.group.endsWith(':step:0')), 'balanced opening');
  await until(async () => (await tail(initial)).some(item => item.group.endsWith(':step:2')), 'balanced midpoint', 16000);
  await until(async () => (await tail(initial)).some(item => item.group.endsWith(':done:0')), 'natural Rested response', 18000);
  await until(async () => (await audio()).starts.some(item => item.completionVisible), 'completion plays inside Rested');
  await page.screenshot({ path: path.join(out, 'rested-response.png') });
  const balanced = await tail(initial);
  assert.equal(balanced.filter(item => /:step:/.test(item.group)).length, 2);
  assert.equal(balanced.filter(item => item.group.endsWith(':done:0')).length, 1);
  const completion = (await audio()).starts.find(item => item.completionVisible);
  assert.match(completion.number, /Rested/i);
  await until(async () => ui(function () { return !this.querySelector('#ov').classList.contains('on'); }), 'Rested closes after the response', 16000);
  assert.equal((await otherUI(function () { return globalThis.__voiceEventQA; })).starts.length, 0, 'Background tab never duplicates speech');
  assert.equal((await audio()).maxActive, 1, 'Balanced guidance and completion never overlap');

  await patch({ restGuidance: 'quiet', voiceDone: false });
  const quietAt = (await selections()).length; await start();
  await until(async () => (await tail(quietAt)).some(item => item.group.endsWith(':step:0')), 'quiet opening');
  await until(async () => (await worker.evaluate(async () => (await chrome.storage.local.get('state')).state.phase)) === 'work', 'quiet rest finishes naturally', 24000);
  const quiet = await tail(quietAt); assert.equal(quiet.length, 1); assert.match(quiet[0].group, /:step:0$/);
  await wait(3800);

  await patch({ voiceSnooze: true });
  const snoozeAt = (await selections()).length; await start();
  await until(async () => (await tail(snoozeAt)).some(item => item.group.endsWith(':step:0')), 'opening before snooze');
  await click('#ov [data-a="snooze"]');
  await until(async () => (await tail(snoozeAt)).some(item => item.group.endsWith(':snooze:0')), 'page snooze response');
  await until(async () => (await audio()).starts.some(item => /Snoozed/i.test(item.title)), 'snooze reaction plays during its toast');
  const snooze = (await tail(snoozeAt)).filter(item => item.group.endsWith(':snooze:0')); assert.equal(snooze.length, 1);
  await wait(7500); const idleAt = (await selections()).length; await wait(1500); assert.equal((await selections()).length, idleAt, 'No later idle speech');

  const popup = await context.newPage(); await popup.goto(worker.url().replace('background.js', 'popup.html'));
  await page.bringToFront(); await page.mouse.click(180, 100);
  const popupAt = (await selections()).length;
  await popup.locator('#b-snooze').evaluate(button => button.click());
  await until(async () => (await tail(popupAt)).some(item => item.group.endsWith(':snooze:0')), 'popup snooze reaches foreground page');
  assert.equal((await tail(popupAt)).filter(item => item.group.endsWith(':snooze:0')).length, 1);
  await wait(7500);
  const silentAt = (await selections()).length;
  await popup.locator('#b-pause').evaluate(button => button.click()); await popup.locator('#b-pause').evaluate(button => button.click());
  await start(); await click('#ov [data-a="skip"]'); await wait(1400);
  assert.equal((await selections()).length, silentAt, 'Pause, resume and immediate skip remain quiet');
  for (const disabled of [{ voiceSnooze: false }, { voiceSnooze: true, voiceOn: false },
    { voiceOn: true, mutedClips: Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'audio/manifest.json'))).clips) }]) {
    await patch(disabled); const before = (await selections()).length;
    await popup.locator('#b-snooze').evaluate(button => button.click()); await wait(1200);
    assert.equal((await selections()).length, before, 'Disabled or muted snooze reactions stay silent');
  }
  assert.deepEqual(errors, []); assert.equal(requests.filter(url => /api\.elevenlabs\.io/.test(url)).length, 0);
  const report = { balanced, quiet, snooze, completion, audio: await audio(), secondTabAudio: await otherUI(function () { return globalThis.__voiceEventQA; }),
    allSelections: await selections(), requests: await worker.evaluate(() => __voiceRequests), errors,
    checks: ['balanced 20-second rest has two steps and one visible completion', 'quiet mode has one opening without disabled completion',
      'page and popup snooze each react once', 'background tab never duplicates', 'no overlapping playback',
      'pause/resume/skip and later idle are silent', 'voice and reaction switches and mutes suppress snooze', 'restrictive CSP and offline playback'] };
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (context) await context.close(); if (server) await new Promise(resolve => server.close(resolve));
  if (profile) fs.rmSync(profile, { recursive: true, force: true });
});
