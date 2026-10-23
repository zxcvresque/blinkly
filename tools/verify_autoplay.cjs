/* Strict Chromium autoplay QA. No profile, engagement score, or gesture bypass is used. */
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.resolve(process.env.BLINKLY_EXTENSION_ROOT || path.join(__dirname, '..'));
const out = process.env.BLINKLY_AUTOPLAY_QA_DIR || '/private/tmp/blinkly-autoplay-qa';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let context, server, profile;
const warnings = [], errors = [], instrumentErrors = [], sessions = [];
async function until(check, label, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await wait(80); }
  throw new Error('Timed out: ' + label);
}
async function observedPage(url) {
  const page = await context.newPage(), client = await context.newCDPSession(page), native = new Map(), sources = [];
  page.on('console', message => { if (message.type() === 'warning') warnings.push(message.text()); if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  client.on('WebAudio.contextCreated', ({ context }) => native.set(context.contextId, context));
  client.on('WebAudio.contextChanged', ({ context }) => native.set(context.contextId, context));
  client.on('WebAudio.audioNodeCreated', ({ node }) => {
    if (/BufferSource/i.test(node.nodeType)) sources.push({ at: Date.now(), state: native.get(node.contextId)?.contextState, nodeType: node.nodeType });
  });
  await client.send('WebAudio.enable'); await client.send('DOM.enable');
  const find = node => node.attributes?.includes('blinkly-root') ? node.shadowRoots?.[0]
    : [...(node.children || []), ...(node.shadowRoots || [])].map(find).find(Boolean);
  await page.goto(url);
  await until(async () => !!find((await client.send('DOM.getDocument', { depth: -1, pierce: true })).root), 'content root injects');
  const ui = async (fn, value) => {
    const node = find((await client.send('DOM.getDocument', { depth: -1, pierce: true })).root);
    assert.ok(node, 'Live content root');
    const { object } = await client.send('DOM.resolveNode', { backendNodeId: node.backendNodeId });
    const result = await client.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: fn.toString(),
      arguments: [{ value }], returnByValue: true, awaitPromise: true, userGesture: false });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const stats = async () => ({ constructed: native.size, starts: [...sources],
    states: [...native.values()].map(value => value.contextState),
    activation: await ui(function () { return this.ownerDocument.defaultView.navigator.userActivation.hasBeenActive; }) });
  const entry = { page, stats, ui }; sessions.push(entry); return entry;
}
(async () => {
  fs.mkdirSync(out, { recursive: true });
  server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'none'; connect-src 'none'; media-src 'none'; style-src 'unsafe-inline'");
    res.end('<!doctype html><title>Strict autoplay check</title><h1>Strict autoplay check</h1><p>No page gesture yet.</p>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'blinkly-autoplay-browser-'));
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.BLINKLY_BROWSER || '/Applications/Helium.app/Contents/MacOS/Helium',
    headless: true, ignoreDefaultArgs: ['--disable-extensions'], viewport: { width: 1365, height: 900 },
    args: ['--disable-extensions-except=' + ROOT, '--load-extension=' + ROOT,
      '--autoplay-policy=document-user-activation-required',
      '--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies']
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  worker.on('console', message => { if (message.type() === 'warning') warnings.push(message.text()); if (message.type() === 'error') errors.push(message.text()); });
  const extensionId = new URL(worker.url()).hostname;
  const config = { workMin: 60, breakSec: 20, warnSec: 0, idleMin: 10, voiceOn: true, sound: true,
    voiceDone: false, voiceSnooze: false, restGuidance: 'quiet', sleepEnabled: false, factsEvery: 0, flirty: false };
  await worker.evaluate(async cfg => { await chrome.storage.local.clear(); await chrome.storage.local.set({ cfg }); }, config);
  const setBreak = source => worker.evaluate(async source => {
    const now = Date.now(), { state = {} } = await chrome.storage.local.get('state');
    await chrome.storage.local.set({ state: { ...state, phase: 'break', breakLen: 20, breakEnd: now + 20000,
      elapsed: 0, manualBreak: source === 'popup', paused: false, lastAct: now, res: '', w: 'qa-' + source } });
  }, source);
  const locked = async (entry, label) => {
    await wait(1700); const state = await entry.stats();
    assert.equal(state.activation, false, label + ': no page activation ' + JSON.stringify(state));
    assert.equal(state.constructed, 0, label + ': no context created ' + JSON.stringify(state));
    assert.equal(state.starts.length, 0, label + ': no playback attempted'); return state;
  };
  const first = await observedPage(url + '/automatic', extensionId); await first.page.bringToFront();
  const loadLocked = await locked(first, 'Initial load');
  await setBreak('automatic'); const automaticLocked = await locked(first, 'Automatic break before gesture');
  await first.page.mouse.click(180, 100);
  await until(async () => (await first.stats()).states.includes('running'), 'trusted click unlocks a running context');
  await until(async () => (await first.stats()).starts.length > 0, 'current visible guidance plays after the gesture');
  const unlocked = await first.stats(); assert.ok(unlocked.starts.every(start => start.state === 'running'));
  await first.page.close();

  await worker.evaluate(async () => { const { state } = await chrome.storage.local.get('state'); await chrome.storage.local.set({ state: { ...state, phase: 'work', res: '', elapsed: 0, w: 'qa-clear' } }); });
  const second = await observedPage(url + '/popup-style', extensionId); await second.page.bringToFront();
  await setBreak('popup'); const popupLocked = await locked(second, 'Popup-style storage break before page gesture');
  await worker.evaluate(async () => {
    const { state } = await chrome.storage.local.get('state');
    await chrome.storage.local.set({ state: { ...state, phase: 'work', res: 'skip', resAt: Date.now(), breakEnd: 0, elapsed: 0, w: 'qa-cancel' } });
  });
  await wait(200); await second.page.mouse.click(180, 100); await wait(1900);
  const canceled = await second.stats(); assert.equal(canceled.starts.length, 0, 'Canceled locked guidance never replays after a later gesture');
  await second.page.keyboard.press('Alt+Shift+E');
  await until(async () => second.ui(function () { return this.querySelector('#panel').classList.contains('on'); }), 'settings opens');
  await second.ui(function () {
    this.querySelector('#tabs [data-t="voice"]').click();
    this.querySelector('[data-a="vtest"]').scrollIntoView({ block: 'center' });
  });
  await wait(400);
  const point = await second.ui(function () {
    const r = this.querySelector('[data-a="vtest"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await second.page.mouse.click(point.x, point.y);
  await until(async () => (await second.stats()).starts.length > 0, 'trusted Test voice starts playback');
  const preview = await second.stats(); assert.ok(preview.starts.every(start => start.state === 'running'));
  const autoplayWarnings = warnings.filter(text => /AudioContext.*(?:not allowed|user gesture)|autoplay|resume\(\).*gesture/i.test(text));
  assert.deepEqual(autoplayWarnings, [], 'No autoplay warnings'); assert.deepEqual(instrumentErrors, []); assert.deepEqual(errors, []);
  const report = { policy: 'document-user-activation-required', mediaEngagementBypass: false,
    instrumentation: 'Native CDP WebAudio domain, enabled before navigation; buffer-source creation is playback pipeline evidence, not a direct start-hook.',
    resumeAttemptVerification: 'Covered by audio-activation unit tests; the native WebAudio protocol does not expose resume calls.', loadLocked, automaticLocked,
    unlocked, popupLocked, canceled, preview, warnings, errors, instrumentErrors,
    checks: ['no native audio context or buffer source before page activation', 'automatic and popup-style breaks stay locked',
      'real page click unlocks current guidance', 'canceled locked clips never replay', 'trusted Test voice creates buffer sources on running contexts', 'no autoplay console warnings'] };
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (context) await context.close(); if (server) await new Promise(resolve => server.close(resolve));
  if (profile) fs.rmSync(profile, { recursive: true, force: true });
});
