/* Optional integration check. Uses a temporary Helium profile, never your normal profile. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.resolve(__dirname, '..');
const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'audio/manifest.json')));
const V = require(path.join(ROOT, 'voice-lines.js'));
const reportDir = process.env.BLINKLY_QA_DIR || '/private/tmp/blinkly-qa';
fs.mkdirSync(reportDir, { recursive: true });
let context, server;
const errors = [], requests = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
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
  const node = search(root); assert.ok(node, 'Blinkly closed shadow root was injected');
  const { object } = await client.send('DOM.resolveNode', { nodeId: node.nodeId });
  return async (fn, arg) => {
    const result = await client.send('Runtime.callFunctionOn', {
      objectId: object.objectId, functionDeclaration: fn.toString(),
      arguments: [{ value: arg }], returnByValue: true, awaitPromise: true, userGesture: true
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
}
(async () => {
  server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    // Restrictive page CSP verifies audio comes through the worker rather than page fetch/media.
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'none'; connect-src 'none'; media-src 'none'; style-src 'unsafe-inline'");
    res.end('<!doctype html><title>Blinkly integration</title><h1>Offline reminder check</h1><p>Local test page.</p>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'blinkly-browser-'));
  context = await chromium.launchPersistentContext(profile, {
    executablePath: '/Applications/Helium.app/Contents/MacOS/Helium', headless: true,
    ignoreDefaultArgs: ['--disable-extensions'], viewport: { width: 1365, height: 900 },
    args: ['--disable-extensions-except=' + ROOT, '--load-extension=' + ROOT, '--autoplay-policy=no-user-gesture-required']
  });
  context.on('request', request => requests.push(request.url()));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  worker.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await worker.evaluate(async () => { await chrome.storage.local.clear(); await chrome.storage.local.set({cfg:{restGuidance:'quiet',voiceSnooze:false,voiceDone:false}}); });
  const options = await context.newPage();
  options.on('pageerror', error => errors.push(error.message));
  await options.goto(worker.url().replace('background.js', 'options.html'));
  await wait(300);
  const settings = await shadow(options);
  await settings(function () { this.querySelector('[data-t="voice"]').click(); });
  await settings(function () { this.querySelector('[data-a="vtest"]').click(); });
  await wait(300);
  const voiceStatus = await settings(function () { return this.querySelector('#vstat').textContent; });
  assert.match(voiceStatus, /recordings ready/);
  await options.screenshot({ path: path.join(reportDir, 'voice-settings.png') });

  // Decode every actual file through the browser's own audio decoder.
  const decodeReport = await options.evaluate(async clips => {
    const c = new AudioContext(), results = [];
    for (const clip of clips) {
      const response = await chrome.runtime.sendMessage({ type: 'blinkly-audio', key: clip.key });
      if (!response.ok) throw new Error(clip.key + ': ' + response.error);
      const bytes = Uint8Array.from(atob(response.b64), char => char.charCodeAt(0));
      const buf = await c.decodeAudioData(bytes.buffer);
      if (!(buf.duration > 0)) throw new Error('Empty audio: ' + clip.key);
      results.push({ key: clip.key, duration: buf.duration, channels: buf.numberOfChannels, sampleRate: buf.sampleRate });
    }
    await c.close(); return results;
  }, Object.values(pack.clips));
  fs.writeFileSync(path.join(reportDir, 'audio-decode.json'), JSON.stringify(decodeReport, null, 2) + '\n');

  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url); await wait(200);
  await page.bringToFront(); await page.mouse.click(200, 130);
  const ui = await shadow(page);
  await ui(function () { this.querySelector('[data-a="now"]').click(); });
  await wait(1600);
  const landscape = await ui(function () {
    const canvas = this.querySelector('#rest-landscape'), context = canvas.getContext('2d');
    const pixel = context.getImageData(canvas.width / 2, canvas.height / 3, 1, 1).data;
    return { breaking: this.querySelector('#ov').classList.contains('on'),
      width: canvas.width, height: canvas.height, pixel: [...pixel],
      oldLandscape: !!this.querySelector('.sky,.hills,.water,.refl'),
      fullScreenButton: [...this.querySelectorAll('#ov button')].some(button => /full screen/i.test(button.textContent)),
      number: this.querySelector('#num').textContent };
  });
  assert.equal(landscape.breaking, true); assert.equal(landscape.oldLandscape, false);
  assert.equal(landscape.fullScreenButton, false); assert.equal(landscape.pixel[3], 255);
  assert.ok(landscape.width >= 1000 && landscape.height >= 700);
  await page.screenshot({ path: path.join(reportDir, 'mist-landscape.png') });
  await ui(function () { this.querySelector('[data-a="snooze"]').click(); });
  await wait(150);
  let state = await worker.evaluate(async () => (await chrome.storage.local.get('state')).state);
  assert.equal(state.snoozeCount, 1);
  await ui(function () { this.querySelector('[data-a="snooze"]').click(); });
  state = await worker.evaluate(async () => (await chrome.storage.local.get('state')).state);
  assert.equal(state.snoozeCount, 2);

  // Work-interval settings must never add interval-specific narration.
  await worker.evaluate(async () => {
    const {cfg = {}, state} = await chrome.storage.local.get(['cfg', 'state']);
    await chrome.storage.local.set({ cfg: { ...cfg, workMin: 60, mode: 'card' },
      state: { ...state, phase: 'break', breakLen: 20, breakEnd: Date.now() + 20000, w: 'qa' } });
  });
  await wait(400);
  const card = await ui(function () { return { card: this.querySelector('#ov').classList.contains('card'), number: this.querySelector('#num').textContent }; });
  assert.equal(card.card, true); assert.match(card.number, /^\d+$/);
  await page.screenshot({ path: path.join(reportDir, 'break-card.png') });
  await worker.evaluate(() => {
    globalThis.__qaRequests = [];
    const original = bundledAudio;
    bundledAudio = async key => { __qaRequests.push(key); return original(key); };
  });
  await worker.evaluate(async () => {
    const { state } = await chrome.storage.local.get('state');
    await chrome.storage.local.set({ state: { ...state, breakEnd: Date.now() - 1, w: 'qa-end' } });
  });
  await wait(1800);
  assert.deepEqual(await worker.evaluate(() => __qaRequests), [], 'Completion response is silent when disabled');
  // Pause, resume and snooze from the popup must not speak outside an alert/rest.
  const popup = await context.newPage();
  await popup.goto(worker.url().replace('background.js', 'popup.html'));
  await popup.locator('#b-pause').click(); await popup.locator('#b-pause').click(); await popup.locator('#b-snooze').click();
  await wait(500);
  assert.deepEqual(await worker.evaluate(() => __qaRequests), [], 'Popup responses stay silent when disabled');
  await popup.close(); await page.bringToFront();
  // Trigger a warning after snooze; only an angry warning may be requested.
  await worker.evaluate(async () => {
    const {state} = await chrome.storage.local.get('state');
    await chrome.storage.local.set({ state: { ...state, phase:'work', elapsed:3570, owner:'', lastTick:0, lastAct:Date.now(), paused:false, snoozeCount:2, w:'qa-warn' } });
  });
  await wait(1500);
  const warnedKeys = await worker.evaluate(() => __qaRequests);
  assert.ok(warnedKeys.length > 0, 'Visible warning requests audio');
  const angryKeys = new Set(V.extra.warnSnoozed.map(V.key));
  const drunkKeys = new Set(V.extra.drunkWarn.map(V.key));
  for(const key of warnedKeys) assert.ok(angryKeys.has(key) || drunkKeys.has(key), 'Snoozed warning uses angry or after-2am context');
  await ui(function () { this.querySelector('[data-a="snooze"]').click(); });
  const requestsAtClose = await worker.evaluate(() => __qaRequests.length);
  await wait(1200);
  assert.equal(await worker.evaluate(() => __qaRequests.length), requestsAtClose, 'Closing an alert cancels further narration');
  // Reproduce repeated Take break now, including a full page reload between starts.
  await worker.evaluate(async () => {
    await chrome.storage.local.remove('voiceRotation');
    globalThis.__qaSelections = [];
    const original = selectClip;
    selectClip = async (message, sender) => {
      const result = await original(message, sender);
      if (result.key) __qaSelections.push({group:message.group,key:result.key,session:message.sessionId});
      return result;
    };
  });
  let currentUI = ui;
  const openings = [];
  for (let session = 0; session < 4; session++) {
    if (session === 1) {
      await page.reload(); await wait(250); await page.mouse.click(200,130); currentUI = await shadow(page);
    }
    await currentUI(function () { this.querySelector('[data-a="now"]').click(); });
    await wait(1350);
    const selections = await worker.evaluate(() => __qaSelections);
    const opening = selections.filter(item => item.group.endsWith(':step:0')).at(-1);
    assert.ok(opening, 'Manual break selects an opening');
    openings.push(opening.key);
    if (session === 2) {
      const factKeys = new Set([...V.extra.facts,...V.extra.drunkFacts].map(V.key));
      assert.ok(factKeys.has(opening.key), 'Third session replaces its opening with one fact');
    }
    await currentUI(function () { this.querySelector('[data-a="skip"]').click(); });
    await wait(150);
  }
  assert.equal(new Set(openings.slice(0,3)).size,3,'First three openings differ, including across reload');
  for(let i=1;i<openings.length;i++) assert.notEqual(openings[i],openings[i-1],'No adjacent repeat at shuffle boundary');
  const rotation = await worker.evaluate(async () => (await chrome.storage.local.get('voiceRotation')).voiceRotation);
  assert.equal(rotation.sessionCount,4);
  // Let a real short rest finish: changing on-screen steps must not add speech.
  await worker.evaluate(async () => {
    const {cfg} = await chrome.storage.local.get('cfg');
    await chrome.storage.local.set({cfg:{...cfg, breakSec:20, flirty:true, recipientGender:'female', sleepEnabled:false, factsEvery:0, favoriteClips:[],mutedClips:[]}});
  });
  const beforeCalm = (await worker.evaluate(() => __qaSelections)).length;
  await currentUI(function () { this.querySelector('[data-a="now"]').click(); });
  await wait(21500);
  const calm = (await worker.evaluate(() => __qaSelections)).slice(beforeCalm);
  assert.equal(calm.length, 1, 'A complete real 20-second rest uses just one line');
  assert.ok(calm[0].group.endsWith(':step:0'));
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('state')).state.phase), 'work');
  await worker.evaluate(async () => {
    const {cfg} = await chrome.storage.local.get('cfg');
    await chrome.storage.local.set({cfg:{...cfg,flirty:false}});
  });
  // Quiet hours freeze automatic work time while allowing manual previews and breaks.
  await worker.evaluate(async () => {
    const {cfg,state} = await chrome.storage.local.get(['cfg','state']);
    await chrome.storage.local.set({cfg:{...cfg,quietEnabled:true,quietStart:'00:00',quietEnd:'00:00',workMin:1,idleMin:10},state:{...state,phase:'work',elapsed:50,paused:false,lastAct:Date.now(),w:'qa-quiet'}});
  });
  const selectionCount = await worker.evaluate(() => __qaSelections.length);
  await wait(2200);
  let quietState = await worker.evaluate(async () => (await chrome.storage.local.get('state')).state);
  assert.equal(quietState.phase,'work'); assert.equal(quietState.elapsed,50,'Quiet hours freeze automatic timer');
  assert.equal(await worker.evaluate(() => __qaSelections.length),selectionCount,'Quiet hours do not narrate');
  await currentUI(function () {
    this.querySelector('#panel').classList.add('on');
    this.querySelector('[data-t="voice"]').click();
    this.querySelector('[data-preview]').click();
  });
  await wait(1800);
  const previewDuringQuiet = await currentUI(function () { return this.querySelector('.audio-play.on')?.dataset.preview; });
  assert.equal(previewDuringQuiet,V.key(V.original(20).test),'Quiet-hour timer tick preserves the manual preview until its normal end');
  await currentUI(function () { this.querySelector('[data-a="vstop"]').click(); this.querySelector('[data-a="now"]').click(); });
  await wait(1350);
  quietState = await worker.evaluate(async () => (await chrome.storage.local.get('state')).state);
  assert.equal(quietState.phase,'break'); assert.equal(quietState.manualBreak,true);
  assert.ok(await worker.evaluate(() => __qaSelections.length)>selectionCount,'Manual break narrates during quiet hours');
  await currentUI(function () { this.querySelector('[data-a="skip"]').click(); });

  // Only the eligible unmuted favorite should narrate this step.
  const dayOpenings = V.pool('step',{periodOverride:'day',step:0});
  const favoriteA = V.key(dayOpenings[0]), favoriteB = V.key(dayOpenings[1]);
  await worker.evaluate(async ({a,b}) => {
    const {cfg} = await chrome.storage.local.get('cfg');
    await chrome.storage.local.set({cfg:{...cfg,quietEnabled:false,sleepEnabled:false,favoriteClips:[a,b],mutedClips:[a],factsEvery:0}});
  },{a:favoriteA,b:favoriteB});
  await currentUI(function () { this.querySelector('[data-a="now"]').click(); });
  await wait(1350);
  const favoriteSelection = (await worker.evaluate(() => __qaSelections)).filter(item=>item.group.endsWith(':step:0')).at(-1);
  assert.equal(favoriteSelection.key,favoriteB,'Muted favorite excluded and remaining favorite preferred');
  await currentUI(function () { this.querySelector('[data-a="skip"]').click(); });
  const finalStatus = await currentUI(function () { return this.querySelector('#vstat').textContent; });
  assert.doesNotMatch(finalStatus, /missing|unavailable|not in|failed/i);
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(requests.filter(url => url.includes('api.elevenlabs.io')).length, 0);
  const report = { browser: 'Helium', savedClipsDecoded: decodeReport.length, voiceStatus, landscape, card, distinctOpeningKeys:openings, shortRestUtterances:calm.length,
    consoleErrors: errors, elevenLabsRequests: 0, checks: ['extension loads', 'settings and test button', 'all MP3s decode', 'restrictive page CSP', 'supplied mist landscape and quiet countdown', 'card sizing', 'snooze escalation', 'silent completion and popup actions', 'angry next alert', 'silence after alert closes', 'distinct manual openings across reload', 'fact replaces the third-session opening','one utterance through a complete 20-second rest','quiet hours freeze automatic reminders','manual preview and break during quiet hours','unmuted favorite preferred'] };
  fs.writeFileSync(path.join(reportDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; })
.finally(async () => { if (context) await context.close(); if (server) await new Promise(resolve => server.close(resolve)); });
