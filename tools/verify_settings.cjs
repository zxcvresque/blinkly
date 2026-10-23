/* Browser settings QA. Uses its own disposable Helium profile and the bundled offline pack. */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.resolve(__dirname, '..');
const reportDir = process.env.BLINKLY_SETTINGS_QA_DIR || '/private/tmp/blinkly-settings-qa';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let context, profile;
const errors = [], requests = [];

async function until(check, label, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await wait(100);
  }
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
  const node = search(root); assert.ok(node, 'Extension closed shadow root is available');
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
  fs.mkdirSync(reportDir, { recursive: true });
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'audio/catalog.json')));
  const expectedCount = catalog.clips.length;
  assert.ok(expectedCount > 0, 'Catalog has recordings');
  await until(() => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'audio/manifest.json')));
    return manifest.complete && manifest.count === expectedCount;
  }, `${expectedCount} complete offline recordings`, 120000);
  const optionsSource = fs.readFileSync(path.join(ROOT, 'options.html'), 'utf8');
  assert.ok(optionsSource.indexOf('src="reminder-preferences.js"') >= 0
    && optionsSource.indexOf('src="reminder-preferences.js"') < optionsSource.indexOf('src="blinkly.user.js"'),
  'Reminder preferences load before the settings runtime');
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'blinkly-settings-browser-'));
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.BLINKLY_BROWSER || '/Applications/Helium.app/Contents/MacOS/Helium',
    headless: true, ignoreDefaultArgs: ['--disable-extensions'], viewport: { width: 1365, height: 1000 },
    args: ['--disable-extensions-except=' + ROOT, '--load-extension=' + ROOT, '--autoplay-policy=no-user-gesture-required']
  });
  context.on('request', request => requests.push(request.url()));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  worker.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await worker.evaluate(() => chrome.storage.local.clear());
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    const active = new Set();
    window.__settingsAudio = { started: 0, active: 0 };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      active.add(this); __settingsAudio.started++; __settingsAudio.active = active.size;
      this.addEventListener('ended', () => { active.delete(this); __settingsAudio.active = active.size; }, { once: true });
      return start.apply(this, args);
    };
  });
  await page.goto(worker.url().replace('background.js', 'options.html'));
  await wait(300);
  assert.equal(await page.evaluate(() => typeof globalThis.BlinklyPreferences?.normalize), 'function');
  let ui = await shadow(page);
  const click = selector => ui(function (selector) {
    const element = this.querySelector(selector); if (!element) throw new Error('Missing element: ' + selector);
    element.click();
  }, selector);
  const change = (selector, value, event = 'change') => ui(function ({ selector, value, event }) {
    const element = this.querySelector(selector); if (!element) throw new Error('Missing element: ' + selector);
    if (element.type === 'checkbox') element.checked = value; else element.value = value;
    element.dispatchEvent(new Event(event, { bubbles: true }));
  }, { selector, value, event });
  const config = () => worker.evaluate(async () => (await chrome.storage.local.get('cfg')).cfg);
  const reload = async () => { await page.reload(); await wait(300); ui = await shadow(page); };
  const controls = () => ui(function () {
    return {
      tab: this.querySelector('#tabs button.on')?.dataset.t,
      count: this.querySelectorAll('.audio-item').length,
      category: this.querySelector('#library-category').value,
      search: this.querySelector('#library-search').value,
      preference: this.querySelector('#library-preference').value,
      accentColor: this.querySelector('input[type="color"][data-k="accent"]').value,
      accentHex: this.querySelector('input[type="text"][data-k="accent"]').value,
      accentCss: this.querySelector('#wrap').style.getPropertyValue('--ac'),
      bedtime: this.querySelector('[data-k="bedtime"]').value,
      sleepMode: this.querySelector('[data-k="sleepMode"]').value,
      sleepWorkMin: this.querySelector('[data-k="sleepWorkMin"]').value,
      quietEnabled: this.querySelector('[data-k="quietEnabled"]').checked,
      quietStart: this.querySelector('[data-k="quietStart"]').value,
      quietEnd: this.querySelector('[data-k="quietEnd"]').value,
      factsEvery: this.querySelector('[data-k="factsEvery"]').value,
      workMin: this.querySelector('[data-k="workMin"]').value,
      flirty: this.querySelector('[data-k="flirty"]').checked,
      recipientGender: this.querySelector('[data-k="recipientGender"]').value,
      restGuidance: this.querySelector('[data-k="restGuidance"]').value,
      voiceSnooze: this.querySelector('[data-k="voiceSnooze"]').checked,
      voiceDone: this.querySelector('[data-k="voiceDone"]').checked
    };
  });

  await click('#tabs [data-t="voice"]');
  await until(async () => (await controls()).count === expectedCount, `${expectedCount} library entries`);
  assert.equal((await controls()).recipientGender, 'male', 'Existing installations default to male recipient');
  assert.equal((await controls()).restGuidance, 'balanced');
  assert.equal((await controls()).voiceSnooze, true); assert.equal((await controls()).voiceDone, true);
  await change('[data-k="restGuidance"]','quiet');
  await change('[data-k="voiceSnooze"]',false,'input'); await change('[data-k="voiceDone"]',false,'input');
  await reload();
  assert.equal((await controls()).restGuidance,'quiet');
  assert.equal((await controls()).voiceSnooze,false); assert.equal((await controls()).voiceDone,false);
  await change('[data-k="restGuidance"]','balanced');
  await change('[data-k="voiceSnooze"]',true,'input'); await change('[data-k="voiceDone"]',true,'input');
  await reload();
  assert.equal((await controls()).restGuidance,'balanced');
  assert.equal((await controls()).voiceSnooze,true); assert.equal((await controls()).voiceDone,true);

  const recipientOptions = await ui(function () {
    return [...this.querySelector('[data-k="recipientGender"]').options].map(option => ({ value: option.value, label: option.textContent }));
  });
  assert.deepEqual(recipientOptions, [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]);
  const voiceSettingsCopy = await ui(function () { return this.querySelector('.tab[data-t="voice"]').textContent; });
  assert.doesNotMatch(voiceSettingsCopy, /Offline voice pack|hpp4J3VqNfWAUOO0d1Us|API key|Eleven v\d/);
  assert.match(voiceSettingsCopy, /Speaking to/);
  assert.match(voiceSettingsCopy, /Mix playful pet names into guidance/);
  for (const recipientGender of ['female', 'male']) {
    await change('[data-k="recipientGender"]', recipientGender);
    await until(async () => (await config()).recipientGender === recipientGender, `${recipientGender} recipient saves`);
    await reload();
    assert.equal((await controls()).recipientGender, recipientGender, `${recipientGender} recipient restores`);
  }
  await until(async () => (await controls()).count === expectedCount, 'Library restores after recipient selection');
  const entries = await ui(function () {
    return [...this.querySelectorAll('.audio-item')].map(item => ({
      title: item.querySelector('b').textContent,
      key: item.querySelector('[data-preview]').dataset.preview,
      favoriteKey: item.querySelector('[data-favorite]').dataset.favorite,
      muteKey: item.querySelector('[data-mute]').dataset.mute,
      label: item.querySelector('[data-preview]').getAttribute('aria-label'),
      transcript: item.querySelector('.audio-text').textContent
    }));
  });
  assert.equal(new Set(entries.map(entry => entry.key)).size, expectedCount);
  assert.equal(new Set(entries.map(entry => entry.title)).size, expectedCount);
  for (const entry of entries) {
    const clip = catalog.clips.find(clip => clip.key === entry.key);
    assert.ok(clip, entry.key); assert.equal(entry.title, clip.title);
    assert.equal(entry.favoriteKey, entry.key); assert.equal(entry.muteKey, entry.key);
    assert.equal(entry.label, `Play ${clip.title}`); assert.equal(entry.transcript, clip.transcript);
    assert.doesNotMatch(entry.transcript, /\bIndia\b/i);
  }
  await wait(550);
  await page.screenshot({ path: path.join(reportDir, 'voice-settings.png') });
  await ui(function () {
    const body = this.querySelector('.body'), target = this.querySelector('#audio-library');
    body.scrollTop += target.getBoundingClientRect().top - body.getBoundingClientRect().top;
  });
  await wait(150);
  await page.screenshot({ path: path.join(reportDir, 'voice-library.png') });
  await ui(function () { this.querySelector('.body').scrollTop = 0; });

  // Every entry is wired to its own saved key; exercise two actual decoder/playback paths.
  const previewStates = [];
  for (let i = 0; i < 2; i++) {
    await click(`[data-preview="${entries[i].key}"]`);
    await until(async () => (await page.evaluate(() => __settingsAudio.started)) >= i + 1, `preview ${i + 1} starts`);
    const state = await ui(function () {
      return { active: this.querySelectorAll('.audio-play.on').length, key: this.querySelector('.audio-play.on')?.dataset.preview };
    });
    assert.ok(state.active <= 1, 'Only one preview control can be active');
    previewStates.push(state);
  }
  await click('[data-a="vstop"]');
  await until(async () => (await page.evaluate(() => __settingsAudio.active)) === 0, 'preview audio stops');
  assert.equal(await ui(function () { return this.querySelectorAll('.audio-play.on').length; }), 0);

  await change('#library-category', 'Alerts');
  const categoryCount = (await controls()).count;
  assert.ok(categoryCount > 0 && categoryCount < expectedCount);
  await change('#library-search', 'handsome', 'input');
  const searchCount = (await controls()).count;
  assert.ok(searchCount > 0 && searchCount < categoryCount);
  await reload();
  await until(async () => (await controls()).count === searchCount, 'library filters restore');
  let restored = await controls();
  assert.equal(restored.tab, 'voice'); assert.equal(restored.category, 'Alerts'); assert.equal(restored.search, 'handsome');

  // Preferences affect both the current filtered list and the saved configuration.
  await change('#library-category', ''); await change('#library-search', '', 'input');
  await change('#library-preference', 'all');
  await until(async () => (await controls()).count === expectedCount, 'all recordings after clearing filters');
  const favoriteKey = entries[1].key, mutedKey = entries[2].key;
  await click(`[data-favorite="${favoriteKey}"]`);
  await click(`[data-mute="${mutedKey}"]`);
  await until(async () => {
    const cfg = await config();
    return cfg.favoriteClips?.includes(favoriteKey) && cfg.mutedClips?.includes(mutedKey);
  }, 'favorite and mute save');
  assert.equal(await ui(function (key) { return this.querySelector(`[data-favorite="${key}"]`).getAttribute('aria-pressed'); }, favoriteKey), 'true');
  assert.equal(await ui(function (key) { return this.querySelector(`[data-mute="${key}"]`).getAttribute('aria-pressed'); }, mutedKey), 'true');
  await change('#library-preference', 'favorites');
  assert.equal((await controls()).count, 1);
  assert.equal(await ui(function () { return this.querySelector('[data-preview]')?.dataset.preview; }), favoriteKey);
  await reload();
  await until(async () => (await controls()).count === 1, 'favorite filter restores');
  assert.equal((await controls()).preference, 'favorites');
  await click(`[data-favorite="${favoriteKey}"]`);
  assert.equal((await controls()).count, 0, 'unfavoriting removes the current filtered item');
  await change('#library-preference', 'muted');
  assert.equal((await controls()).count, 1);
  assert.equal(await ui(function () { return this.querySelector('[data-preview]')?.dataset.preview; }), mutedKey);
  await reload();
  await until(async () => (await controls()).count === 1, 'muted filter restores');
  assert.equal((await controls()).preference, 'muted');
  await click(`[data-preview="${mutedKey}"]`);
  await until(async () => (await page.evaluate(() => __settingsAudio.started)) > 0, 'muted recording remains manually previewable');
  await click('[data-a="vstop"]');
  await until(async () => (await page.evaluate(() => __settingsAudio.active)) === 0, 'muted manual preview stops');
  await click(`[data-mute="${mutedKey}"]`);
  assert.equal((await controls()).count, 0, 'unmuting removes the current filtered item');
  await until(async () => {
    const cfg = await config();
    return !cfg.favoriteClips.includes(favoriteKey) && !cfg.mutedClips.includes(mutedKey);
  }, 'favorite and mute removal save');
  await change('#library-preference', 'all');
  await until(async () => (await controls()).count === expectedCount, 'all recordings remain previewable');

  const factOptions = await ui(function () { return [...this.querySelector('[data-k="factsEvery"]').options].map(option => option.value); });
  assert.deepEqual(factOptions, ['0', '1', '2', '3', '5', '10']);
  await change('[data-k="factsEvery"]', '0');
  await until(async () => (await config()).factsEvery === 0, 'facts can be disabled');
  await reload(); assert.equal((await controls()).factsEvery, '0');
  await change('[data-k="factsEvery"]', '5');
  await until(async () => (await config()).factsEvery === 5, 'fact frequency saves');
  await reload(); assert.equal((await controls()).factsEvery, '5');

  await click('#tabs [data-t="comfort"]');
  await change('input[type="color"][data-k="accent"]', '#2a76c4', 'input');
  await until(async () => (await config()).accent === '#2a76c4', 'custom color saves');
  assert.equal((await controls()).accentHex, '#2a76c4');
  await change('input[type="text"][data-k="accent"]', '#A73BCD');
  await until(async () => (await config()).accent === '#a73bcd', 'hex saves and normalizes');
  let accent = await controls();
  assert.equal(accent.accentColor, '#a73bcd'); assert.equal(accent.accentCss, '#a73bcd');
  await wait(550);
  await page.screenshot({ path: path.join(reportDir, 'custom-accent.png') });
  await reload();
  restored = await controls();
  assert.equal(restored.tab, 'comfort'); assert.equal(restored.accentHex, '#a73bcd'); assert.equal(restored.accentCss, '#a73bcd');

  await click('#tabs [data-t="rhythm"]');
  await change('[data-k="workMin"]', '27', 'input');
  await change('[data-k="breakSec"]', '35', 'input');
  await click('#tabs [data-t="sleep"]');
  await change('[data-k="sleepEnabled"]', true, 'input');
  await change('[data-k="bedtime"]', '23:45');
  await change('[data-k="sleepTimezone"]', 'UTC');
  await change('[data-k="sleepMode"]', 'frequent');
  await change('[data-k="sleepLeadMin"]', '90', 'input');
  await change('[data-k="sleepWorkMin"]', '7', 'input');
  await change('[data-k="sleepLateStyle"]', 'sleepy');
  await change('[data-k="quietEnabled"]', true, 'input');
  await change('[data-k="quietStart"]', '23:00');
  await change('[data-k="quietEnd"]', '06:30');
  await until(async () => (await config()).sleepWorkMin === 7, 'sleep values save');
  const note = await ui(function () { return this.querySelector('#sleep-note').textContent; });
  assert.match(note, /23:45/); assert.match(note, /UTC/); assert.match(note, /27 and 7/);
  await wait(550);
  await page.screenshot({ path: path.join(reportDir, 'sleep-settings.png') });
  await ui(function () {
    const body = this.querySelector('.body'), target = this.querySelector('[data-k="quietEnd"]');
    body.scrollTop += target.getBoundingClientRect().top - body.getBoundingClientRect().top - body.clientHeight / 2;
  });
  await wait(150);
  await page.screenshot({ path: path.join(reportDir, 'quiet-hours.png') });
  await reload();
  restored = await controls();
  assert.equal(restored.tab, 'sleep'); assert.equal(restored.bedtime, '23:45');
  assert.equal(restored.sleepMode, 'frequent'); assert.equal(restored.sleepWorkMin, '7'); assert.equal(restored.workMin, '27');
  assert.equal(restored.quietEnabled, true); assert.equal(restored.quietStart, '23:00'); assert.equal(restored.quietEnd, '06:30');
  const saved = await config();
  for (const [key, value] of Object.entries({ accent: '#a73bcd', workMin: 27, breakSec: 35, sleepEnabled: true,
    bedtime: '23:45', sleepTimezone: 'UTC', sleepMode: 'frequent', sleepLeadMin: 90, sleepWorkMin: 7, sleepLateStyle: 'sleepy',
    quietEnabled: true, quietStart: '23:00', quietEnd: '06:30', factsEvery: 5 }))
    assert.equal(saved[key], value, key);
  await change('[data-k="quietEnabled"]', false, 'input');
  await until(async () => (await config()).quietEnabled === false, 'quiet hours can be disabled');
  await reload();
  assert.equal((await controls()).quietEnabled, false);
  assert.equal((await controls()).quietStart, '23:00'); assert.equal((await controls()).quietEnd, '06:30');

  await click('#tabs [data-t="voice"]');
  await change('[data-k="flirty"]', true, 'input');
  await until(async () => (await config()).flirty === true, 'flirty preference saves');
  await reload();
  assert.equal((await controls()).flirty, true); assert.equal((await controls()).tab, 'voice');
  await change('[data-k="flirty"]', false, 'input');
  await until(async () => (await config()).flirty === false, 'flirty preference can be disabled');
  await reload(); assert.equal((await controls()).flirty, false);
  // Check every panel at a phone-width viewport, with no separate browser/profile.
  await page.setViewportSize({ width: 360, height: 780 });
  const narrowPanels = [];
  for (const tab of ['rhythm', 'comfort', 'smart', 'sleep', 'voice', 'today']) {
    await click(`#tabs [data-t="${tab}"]`);
    await ui(function () { this.querySelector('.body').scrollTop = 0; });
    await wait(400);
    const layout = await ui(function () {
      const panel = this.querySelector('#panel').getBoundingClientRect();
      const active = this.querySelector('.tab.on');
      const clipping = [...active.querySelectorAll('input,select,textarea,button'), ...this.querySelectorAll('#tabs button,.pf button')]
        .filter(element => element.getBoundingClientRect().width > 0)
        .map(element => ({ selector: element.dataset.k || element.dataset.a || element.dataset.t || element.id || element.textContent,
          left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right }))
        .filter(box => box.left < panel.left - 1 || box.right > panel.right + 1);
      return { panel: { left: panel.left, right: panel.right, width: panel.width }, clipping };
    });
    assert.ok(layout.panel.left >= 0 && layout.panel.right <= 360, `Panel ${tab} stays in the viewport`);
    assert.deepEqual(layout.clipping, [], `Controls stay inside ${tab}: ${JSON.stringify(layout.clipping)}`);
    narrowPanels.push({ tab, ...layout });
    await page.screenshot({ path: path.join(reportDir, `narrow-${tab}.png`) });
    if (tab === 'voice') {
      await ui(function () {
        const body = this.querySelector('.body'), target = this.querySelector('#audio-library');
        body.scrollTop += target.getBoundingClientRect().top - body.getBoundingClientRect().top;
      });
      await wait(100);
      await page.screenshot({ path: path.join(reportDir, 'narrow-voice-library.png') });
    }
    if (tab === 'sleep') {
      await ui(function () {
        const body = this.querySelector('.body'), target = this.querySelector('[data-k="quietEnd"]');
        body.scrollTop += target.getBoundingClientRect().top - body.getBoundingClientRect().top - body.clientHeight / 2;
      });
      await wait(100);
      await page.screenshot({ path: path.join(reportDir, 'narrow-quiet-hours.png') });
    }
  }
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(requests.filter(url => url.includes('api.elevenlabs.io')).length, 0);
  const report = { browser: 'Helium', libraryEntries: entries.length, categoryCount, searchCount,
    previewKeys: entries.slice(0, 2).map(entry => entry.key), previewStates, narrowPanels, savedSettings: await config(),
    consoleErrors: errors, elevenLabsRequests: 0,
    checks: [`${expectedCount} named play controls match metadata`, 'male recipient default and male/female selections persist', 'balanced/quiet guidance and snooze/completion switches persist',
      'recipient-neutral settings copy without technical voice details', 'location-free transcripts', 'two previews and stop',
      'single active preview control', 'category and search persist', 'custom color and hex persist',
      'favorite and muted keys persist and filter immediately', 'favorite and muted filters restore',
      'fact frequency and disabled facts persist', 'quiet hours persist and disable',
      'bedtime and frequency settings persist', 'last settings tab restores', 'flirty toggle persists both ways',
      'all six panels and controls fit a 360px viewport'] };
  fs.writeFileSync(path.join(reportDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  for (let i = 0; i < previewStates.length; i++) {
    assert.equal(previewStates[i].active, 1, `Preview ${i + 1} keeps its active stop control`);
    assert.equal(previewStates[i].key, entries[i].key);
  }
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; })
.finally(async () => {
  if (context) await context.close();
  if (profile) fs.rmSync(profile, { recursive: true, force: true });
});
