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
async function observe(page) {
  const client = await context.newCDPSession(page), active = new Set(), qa = { starts: [], maxActive: 0, contexts: [] }, pending = new Set();
  const find = node => node.attributes?.includes('blinkly-root') ? node.shadowRoots?.[0]
    : [...(node.children || []), ...(node.shadowRoots || [])].map(find).find(Boolean);
  await client.send('DOM.enable');
  client.on('WebAudio.contextCreated', ({ context }) => qa.contexts.push({ at: Date.now(), event: 'created', ...context }));
  client.on('WebAudio.contextChanged', ({ context }) => qa.contexts.push({ at: Date.now(), event: 'changed', ...context }));
  const ui = async (fn, arg) => {
    let live;
    for (let retry = 0; retry < 20 && !live; retry++) {
      live = find((await client.send('DOM.getDocument', { depth: -1, pierce: true })).root);
      if (!live) await wait(50);
    }
    assert.ok(live, 'Live Blinkly shadow root');
    const { object } = await client.send('DOM.resolveNode', { backendNodeId: live.backendNodeId });
    const response = await client.send('Runtime.callFunctionOn', { objectId: object.objectId,
      functionDeclaration: fn.toString(), arguments: [{ value: arg }], returnByValue: true, awaitPromise: true, userGesture: false });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  client.on('WebAudio.audioNodeCreated', ({ node }) => {
    if (!/BufferSource/i.test(node.nodeType)) return;
    active.add(node.nodeId); qa.maxActive = Math.max(qa.maxActive, active.size);
    const entry = { at: Date.now(), active: active.size, nodeType: node.nodeType }; qa.starts.push(entry);
    const capture = ui(function () { return { completionVisible: this.querySelector('#ov').matches('.on.done'),
      number: this.querySelector('#num').textContent, toast: this.querySelector('#toast').className,
      title: this.querySelector('#tt').textContent }; }).then(value => Object.assign(entry, value))
      .catch(error => errors.push(error.message)).finally(() => pending.delete(capture));
    pending.add(capture);
  });
  client.on('WebAudio.nodesDisconnected', ({ sourceId }) => active.delete(sourceId));
  client.on('WebAudio.audioNodeWillBeDestroyed', ({ nodeId }) => active.delete(nodeId));
  await client.send('WebAudio.enable');
  const audio = async () => { await Promise.all([...pending]); return JSON.parse(JSON.stringify(qa)); };
  const resetMax = () => { qa.maxActive = active.size; };
  return { ui, audio, resetMax };
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
    args: ['--disable-extensions-except=' + ROOT, '--load-extension=' + ROOT, '--autoplay-policy=document-user-activation-required']
  });
  context.on('request', request => requests.push(request.url()));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {
    await chrome.storage.local.clear(); globalThis.__voiceSelections = []; globalThis.__voiceRequests = [];
    const select = selectClip, audio = bundledAudio;
    selectClip = async (message, sender) => {
      const result = await select(message, sender);
      if (result.key) __voiceSelections.push({ at: Date.now(), group: message.group, key: result.key,
        actionId: message.actionId, sessionId: message.sessionId, preferPetNames: message.preferPetNames, tab: sender.tab?.id });
      return result;
    };
    bundledAudio = async key => { __voiceRequests.push({ at: Date.now(), key }); return audio(key); };
    await chrome.storage.local.set({ cfg: { workMin: 60, breakSec: 20, warnSec: 0, idleMin: 10,
      sound: false, voiceOn: true, voiceDone: true, voiceSnooze: true, restGuidance: 'balanced',
      sleepEnabled: false, factsEvery: 0, flirty: false, mutedClips: [], favoriteClips: [] } });
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  const { ui, audio, resetMax } = await observe(page);
  await page.goto(url); await wait(350); await page.bringToFront(); await page.mouse.click(180, 100);
  await page.keyboard.press('a');
  await until(async () => (await audio()).contexts.length > 0, 'real page gesture creates audio context');
  const click = selector => ui(function (selector) { this.querySelector(selector).click(); }, selector);
  const selections = () => worker.evaluate(() => __voiceSelections);
  const patch = value => worker.evaluate(async value => {
    const { cfg = {} } = await chrome.storage.local.get('cfg'); await chrome.storage.local.set({ cfg: { ...cfg, ...value } });
  }, value);
  const tail = async before => (await selections()).slice(before);
  const start = async () => { await click('[data-a="now"]'); };
  const Voice = require(path.join(ROOT, 'voice-lines.js'));
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'audio/catalog.json')));
  const byKey = new Map(catalog.clips.map(clip => [clip.key, clip]));
  await patch({ warnSec: 30, flirty: true });
  const warningAt = (await selections()).length;
  await worker.evaluate(async () => {
    const { state } = await chrome.storage.local.get('state');
    await chrome.storage.local.set({ state: { ...state, phase: 'work', elapsed: 3600 - 31, res: '',
      lastAct: Date.now(), lastTick: 0, owner: '', paused: false, w: 'qa-warning' } });
  });
  await until(async () => ui(function () { return this.querySelector('#toast').classList.contains('on'); }), 'warning alert becomes visible');
  await page.mouse.click(180, 100);
  try { await until(async () => (await tail(warningAt)).some(item => item.group.endsWith(':warn:0')), 'foreground timer warning'); }
  catch (error) {
    console.error('Warning diagnostic', await worker.evaluate(async () => ({stored:await chrome.storage.local.get(['state','cfg']),requests:__voiceRequests,selections:__voiceSelections,tabs:await chrome.tabs.query({active:true}),windows:await chrome.windows.getAll()})),
      await ui(function () { return {focus:this.ownerDocument.hasFocus(),visibility:this.ownerDocument.visibilityState,activation:this.ownerDocument.defaultView.navigator.userActivation.hasBeenActive,toast:this.querySelector('#toast').className,title:this.querySelector('#tt').textContent,status:this.querySelector('#vstat').textContent}; }),await audio());
    throw error;
  }
  const warning = (await tail(warningAt)).find(item => item.group.endsWith(':warn:0'));
  assert.ok(Voice.petName(byKey.get(warning.key).text), 'Flirty warning actually contains a pet name');
  await until(async () => (await audio()).starts.length > 0, 'Warning recording plays inside visible alert');
  await patch({ warnSec: 0, flirty: false });
  const initial = (await selections()).length;
  await start(); await wait(350); resetMax();
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

  // Exercise the exact storage event shape used by popup.js without opening a second tab.
  const popupAction = type => worker.evaluate(async type => {
    const { state: saved = {} } = await chrome.storage.local.get('state'), state = { ...saved };
    const at = Date.now();
    if (type === 'snooze') { state.phase = 'work'; state.elapsed = 3300; state.snoozeCount = (state.snoozeCount || 0) + 1; }
    else state.paused = !state.paused;
    state.voiceEvent = { id: `${at}-${crypto.randomUUID()}`, type, at }; state.w = 'popup';
    await chrome.storage.local.set({ state });
  }, type);
  const popupAt = (await selections()).length;
  await popupAction('snooze');
  await until(async () => (await tail(popupAt)).some(item => item.group.endsWith(':snooze:0')), 'popup-shaped storage snooze reaches foreground page');
  assert.equal((await tail(popupAt)).filter(item => item.group.endsWith(':snooze:0')).length, 1);
  await wait(7500);
  const silentAt = (await selections()).length;
  await popupAction('pause'); await popupAction('resume');
  await start(); await click('#ov [data-a="skip"]'); await wait(1400);
  assert.equal((await selections()).length, silentAt, 'Pause, resume and immediate skip remain quiet');
  for (const disabled of [{ voiceSnooze: false }, { voiceSnooze: true, voiceOn: false },
    { voiceOn: true, mutedClips: Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'audio/manifest.json'))).clips) }]) {
    await patch(disabled); const before = (await selections()).length;
    await popupAction('snooze'); await wait(1200);
    assert.equal((await selections()).length, before, 'Disabled or muted snooze reactions stay silent');
  }
  const flirty = [];
  for (const recipientGender of ['male', 'female']) {
    await patch({ flirty: true, recipientGender, voiceOn: true, voiceDone: false, voiceSnooze: false,
      restGuidance: 'quiet', factsEvery: 0, mutedClips: [], favoriteClips: [] });
    const before = (await selections()).length, audioBefore = (await audio()).starts.length;
    await start();
    await until(async () => (await tail(before)).some(item => item.group.endsWith(':step:0')), recipientGender + ' named opening');
    const opening = (await tail(before)).find(item => item.group.endsWith(':step:0'));
    assert.equal(opening.preferPetNames, true, 'Saved flirty toggle reaches the selection worker');
    const clip = byKey.get(opening.key);
    assert.ok(Voice.petName(clip.text), 'Flirty opening actually speaks a pet name for ' + recipientGender);
    await until(async () => (await audio()).starts.length > audioBefore, 'Named recording plays');
    flirty.push({ recipientGender, key: opening.key, pet: Voice.petName(clip.text) });
    await click('#ov [data-a="skip"]'); await wait(300);
  }
  assert.deepEqual(errors, []); assert.equal(requests.filter(url => /api\.elevenlabs\.io/.test(url)).length, 0);
  const report = { warning, balanced, quiet, snooze, completion, flirty, audio: await audio(),
    instrumentation: 'Native WebAudio buffer-source creation and disconnection events; fresh closed-root snapshots capture visible playback surfaces.',
    popupCoverage: 'Popup-shaped storage events are exercised; this run does not open a native popup or second browser tab.',
    allSelections: await selections(), requests: await worker.evaluate(() => __voiceRequests), errors,
    checks: ['foreground timer warning speaks within its alert', 'balanced 20-second rest has two steps and one visible completion', 'quiet mode has one opening without disabled completion',
      'page and popup-shaped storage snooze each react once', 'balanced buffer sources never overlap',
      'pause/resume/skip and later idle are silent', 'voice and reaction switches and mutes suppress snooze', 'restrictive CSP and offline playback', 'saved flirty toggle prefers spoken names for both recipients'] };
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (context) await context.close(); if (server) await new Promise(resolve => server.close(resolve));
  if (profile) fs.rmSync(profile, { recursive: true, force: true });
});
