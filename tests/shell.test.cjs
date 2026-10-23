const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const sleepSource = fs.readFileSync(path.join(root, 'sleep-schedule.js'), 'utf8');
const preferencesSource = fs.readFileSync(path.join(root, 'reminder-preferences.js'), 'utf8');
const cadenceSource = fs.readFileSync(path.join(root, 'voice-cadence.js'), 'utf8');
function clockAt(iso) {
  const now = new Date(iso).getTime();
  return class extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
}

function background(pack, browser = {}, stored = {}, now) {
  let listener;
  const fetched = [], actions = {};
  const context = {
    console, Uint8Array, btoa: value => Buffer.from(value, 'binary').toString('base64'),
    chrome: {
      storage: { local: {
        get: async keys => Object.fromEntries(keys.filter(k => k in stored).map(k => [k, structuredClone(stored[k])])),
        set: async values => { Object.assign(stored, structuredClone(values)); }
      }, onChanged: { addListener() {} } },
      runtime: { getURL: file => `chrome-extension://local/${file}`,
        onMessage: { addListener(fn) { listener = fn; } },
        onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
      alarms: { onAlarm: { addListener() {} } }
    },
    fetch: async url => {
      fetched.push(url);
      assert.ok(url.startsWith('chrome-extension://local/'));
      if (url.endsWith('/icons/icon48.png')) {
        if (browser.iconFailure) return { ok: false };
        return { ok: true, arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer };
      }
      return { ok: true, json: async () => pack,
        arrayBuffer: async () => Uint8Array.from([73, 68, 51]).buffer };
    }
  };
  if (now) context.Date = clockAt(now);
  context.chrome.action = {
    setIcon() { throw new Error('The packaged toolbar icon must be preserved'); },
    setBadgeText(value) { actions.badge = value.text; },
    setBadgeBackgroundColor() {}, setTitle(value) { actions.title = value.title; }
  };
  context.chrome.tabs = { query: async query => {
    assert.deepEqual(JSON.parse(JSON.stringify(query)), { active: true, lastFocusedWindow: true });
    if (browser.queryError) throw new Error('Query unavailable');
    return browser.tabs || [{ id: 42 }];
  } };
  context.chrome.windows = { getLastFocused: async () => {
    if (browser.windowError) throw new Error('Window unavailable');
    return browser.window || { focused: true };
  } };
  vm.createContext(context);
  context.importScripts = file => {
    assert.ok(['sleep-schedule.js', 'reminder-preferences.js', 'voice-cadence.js'].includes(file));
    vm.runInContext(file === 'sleep-schedule.js' ? sleepSource : file === 'voice-cadence.js' ? cadenceSource : preferencesSource, context);
  };
  vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context);
  return { fetched, actions, ready: () => new Promise(resolve => setImmediate(resolve)), request: (message, sender = {}) => new Promise(resolve => {
    const handled = listener(message, sender, resolve);
    assert.equal(handled, true);
  }) };
}

test('worker returns bundled audio, validates keys and paths, and caches 12 clips', async () => {
  const clips = Object.fromEntries(Array.from({ length: 13 }, (_, i) =>
    [`vo_${i}`, { file: `audio/vo_${i}.mp3`, bytes: 3, duration: 1 }]));
  clips.vo_bad = { file: 'https://example.com/vo_bad.mp3' };
  clips.vo_mismatch = { file: 'audio/vo_other.mp3' };
  const bg = background({ clips, voiceId: 'test-voice', model: 'test-model' });
  assert.equal((await bg.request({ type: 'blinkly-audio', key: '../voice' })).ok, false);
  assert.equal(bg.fetched.length, 0);
  const first = await bg.request({ type: 'blinkly-audio', key: 'vo_0' });
  assert.equal(first.ok, true);
  assert.equal(first.b64, 'SUQz');
  await bg.request({ type: 'blinkly-audio', key: 'vo_0' });
  assert.equal(bg.fetched.length, 2);
  for (const key of ['vo_bad', 'vo_mismatch', 'vo_missing'])
    assert.equal((await bg.request({ type: 'blinkly-audio', key })).ok, false);
  assert.equal(bg.fetched.length, 2);
  for (let i = 1; i < 13; i++) await bg.request({ type: 'blinkly-audio', key: `vo_${i}` });
  await bg.request({ type: 'blinkly-audio', key: 'vo_0' });
  assert.equal(bg.fetched.length, 15);
  const status = await bg.request({ type: 'blinkly-pack-status' });
  assert.deepEqual(JSON.parse(JSON.stringify(status)), {
    ok: true, count: 13, availableKeys: Array.from({ length: 13 }, (_, i) => `vo_${i}`), expectedCount: 13, complete: false, bytes: 39, duration: 13, voiceId: 'test-voice', model: 'test-model'
  });
});

test('brand icon serves only packaged PNG data and caches concurrent requests', async () => {
  const bg = background({ clips: {} });
  const replies = await Promise.all(Array.from({ length: 3 }, () =>
    bg.request({ type: 'blinkly-brand-icon', file: 'https://example.com/ignored.png' })));
  for (const reply of replies) assert.deepEqual(JSON.parse(JSON.stringify(reply)), {
    ok: true, b64: 'iVBORw==', mime: 'image/png'
  });
  assert.deepEqual(bg.fetched, ['chrome-extension://local/icons/icon48.png']);
  await bg.request({ type: 'blinkly-brand-icon' });
  assert.equal(bg.fetched.length, 1);
});

test('brand icon failures return an error and can retry the packaged file', async () => {
  const browser = { iconFailure: true }, bg = background({ clips: {} }, browser);
  const failure = await bg.request({ type: 'blinkly-brand-icon' });
  assert.equal(failure.ok, false);
  assert.equal(failure.error, 'Packaged brand icon is unavailable');
  browser.iconFailure = false;
  assert.equal((await bg.request({ type: 'blinkly-brand-icon' })).ok, true);
  assert.deepEqual(bg.fetched, ['chrome-extension://local/icons/icon48.png', 'chrome-extension://local/icons/icon48.png']);
});

test('audio library exposes all valid metadata without file paths or audio payloads', async () => {
  const pack = { clips: {
    vo_full: { file: 'audio/vo_full.mp3', title: 'Eyes up', category: 'rest', context: 'drunk',
      mood: 'playful', usage: 'Opening rest step', transcript: 'Eyes up.', tags: ['drunken voice'], b64: 'private' },
    vo_fallback: { file: 'audio/vo_fallback.mp3', text: '[softly] Rest those eyes.' },
    vo_bad: { file: '../escape.mp3', title: 'Invalid' }
  } };
  const bg = background(pack);
  const library = await bg.request({ type: 'blinkly-audio-library' });
  assert.deepEqual(JSON.parse(JSON.stringify(library)), { ok: true, clips: [
    { key: 'vo_full', title: 'Eyes up', category: 'rest', context: 'drunk', mood: 'playful',
      usage: 'Opening rest step', transcript: 'Eyes up.', tags: ['drunken voice'] },
    { key: 'vo_fallback', title: 'Rest those eyes.', category: 'voice', context: 'any', mood: '',
      usage: '', transcript: 'Rest those eyes.', tags: ['softly'] }
  ] });
  assert.equal(bg.fetched.length, 1);
  assert.equal((await bg.request({ type: 'blinkly-pack-status' })).count, library.clips.length);
});

test('toolbar countdown uses bedtime frequency and keeps the packaged icon', async () => {
  for (const [cfg, now, badge, title] of [
    [{ workMin: 20, sleepMode: 'voices' }, '2026-10-22T22:30:00Z', '19', '19:00'],
    [{ workMin: 20, sleepMode: 'frequent', sleepWorkMin: 10 }, '2026-10-22T22:30:00Z', '9', '9:00'],
    [{ workMin: 20, sleepMode: 'frequent', sleepWorkMin: 10 }, '2026-10-23T01:30:00Z', '19', '19:00'],
    [{ workMin: 20, sleepMode: 'frequent', sleepEnabled: false }, '2026-10-22T22:30:00Z', '19', '19:00']
  ]) {
    const bg = background({ clips: {} }, {}, { state: { elapsed: 60 }, cfg }, now);
    await bg.ready();
    assert.equal(bg.actions.badge, badge);
    assert.ok(bg.actions.title.includes(title));
  }
});

test('quiet hours show Zz in toolbar and preserve explicit manual breaks', async () => {
  const cfg = { quietEnabled: true, sleepTimezone: 'UTC' }, now = '2026-10-23T23:30:00Z';
  const bg = background({ clips: {} }, {}, { cfg, state: { phase: 'work', elapsed: 60 } }, now);
  await bg.ready();
  assert.equal(bg.actions.badge, 'Zz');
  assert.equal(bg.actions.title, 'Blinkly: quiet hours');
  const manual = background({ clips: {} }, {}, { cfg, state: {
    phase: 'break', manualBreak: true, breakLen: 20, breakEnd: new Date(now).getTime() + 20000
  } }, now);
  await manual.ready();
  assert.equal(manual.actions.badge, '20s');
  assert.equal(manual.actions.title, 'Blinkly: look 20 feet away');
});

test('speech gate allows the active tab in the focused browser window, including popup focus', async () => {
  const bg = background({ clips: {} });
  const response = await bg.request({ type: 'blinkly-can-speak' }, { tab: { id: 42 } });
  assert.deepEqual(JSON.parse(JSON.stringify(response)), { ok: true, allowed: true });
  assert.equal(bg.fetched.length, 0);
});

test('speech gate denies inactive tabs, background windows, absent senders and API failures', async () => {
  for (const [browser, sender] of [
    [{}, { tab: { id: 7 } }],
    [{ window: { focused: false } }, { tab: { id: 42 } }],
    [{ tabs: [] }, { tab: { id: 42 } }],
    [{}, {}],
    [{ queryError: true }, { tab: { id: 42 } }],
    [{ windowError: true }, { tab: { id: 42 } }]
  ]) {
    const bg = background({ clips: {} }, browser);
    const response = await bg.request({ type: 'blinkly-can-speak' }, sender);
    assert.deepEqual(JSON.parse(JSON.stringify(response)), { ok: true, allowed: false });
    assert.equal(bg.fetched.length, 0);
  }
});

const rotationPack = () => ({ clips: Object.fromEntries([
  ...['a', 'b', 'c'].flatMap(letter => Array.from({ length: 4 }, (_, step) => `vo_${letter}${step}`)),
  'vo_facta', 'vo_factb', 'vo_factc'
].map(key => [key, { file: `audio/${key}.mp3` }])) });
const stepKeys = step => ['a', 'b', 'c'].map(letter => `vo_${letter}${step}`);
const facts = ['vo_facta', 'vo_factb', 'vo_factc'];
const select = (bg, group, keys, sessionId, factKeys, factsEvery, duration, restGuidance = 'quiet') => bg.request({
  type: 'blinkly-select-clip', group, keys, ...(sessionId === undefined ? {} : { sessionId }),
  ...(factKeys === undefined ? {} : { factKeys }), ...(factsEvery === undefined ? {} : { factsEvery }),
  ...(duration === undefined ? {} : { duration }), restGuidance
}, { tab: { id: 42 } });

test('allowed rest-step bags rotate across sessions while intermediate steps remain silent', async () => {
  const stored = {}, bg = background(rotationPack(), {}, stored), results = [[], []];
  for (let round = 0; round < 4; round++) {
    const id = String(1700000000000 + round);
    for (const step of [0, 1, 2, 3]) {
      const response = await select(bg, `drunk:step:${step}`, stepKeys(step), id, undefined, 0, 40, 'balanced');
      assert.equal(response.ok, true);
      if (step === 0 || step === 2) results[step / 2].push(response.key);
      else assert.equal(response.key, null);
    }
  }
  for (const result of results) {
    assert.equal(new Set(result.slice(0, 3)).size, 3);
    assert.notEqual(result[2], result[3]);
  }
  assert.equal(stored.voiceRotation.sessionCount, 4);
  assert.equal(Object.keys(stored.voiceRotation.groups).length, 2);
});

test('rotation persists through worker restart and resets changed pools while retaining last', async () => {
  const stored = {}, pack = rotationPack(), group = 'day:warn:0';
  const first = await select(background(pack, {}, stored), group, stepKeys(0));
  const bg = background(pack, {}, stored);
  const second = await select(bg, group, stepKeys(0));
  const third = await select(bg, group, stepKeys(0));
  assert.equal(new Set([first.key, second.key, third.key]).size, 3);
  const changed = [third.key, stepKeys(0).find(key => key !== third.key)];
  const next = await select(bg, group, changed);
  assert.notEqual(next.key, third.key);
  assert.equal(stored.voiceRotation.groups[group].signature, [...changed].sort().join('|'));
});

test('inactive selection does not read pack, rotate bags, or count a rest session', async () => {
  const browser = { window: { focused: false } }, stored = {};
  const bg = background(rotationPack(), browser, stored);
  const denied = await select(bg, 'drunk:step:0', stepKeys(0), '1700000000000');
  assert.deepEqual(JSON.parse(JSON.stringify(denied)), { ok: true, key: null });
  assert.equal(stored.voiceRotation, undefined);
  assert.equal(bg.fetched.length, 0);
  browser.window.focused = true;
  assert.equal((await select(bg, 'drunk:step:0', stepKeys(0), '1700000000000')).ok, true);
  assert.equal(stored.voiceRotation.sessionCount, 1);
});

test('scheduled facts replace the sole opening utterance of every third rest', async () => {
  const stored = {}, bg = background(rotationPack(), {}, stored), selectedFacts = [];
  for (let n = 1; n <= 9; n++) {
    const id = String(1700000000000 + n);
    const open = await select(bg, 'drunk:step:0', stepKeys(0), id, facts);
    assert.equal(facts.includes(open.key), n % 3 === 0);
    if (n % 3 === 0) selectedFacts.push(open.key);
    // Another tab replaying the opening must not count the same rest twice.
    assert.equal((await select(bg, 'night:step:0', stepKeys(0), id, facts)).key, null);
    for (const step of [1, 2, 3]) assert.equal((await select(bg, `drunk:step:${step}`, stepKeys(step), id)).key, null);
  }
  assert.equal(stored.voiceRotation.sessionCount, 9);
  assert.equal(new Set(selectedFacts).size, 3);
  const unmatched = await select(bg, 'drunk:step:2', stepKeys(2), '999');
  assert.equal(unmatched.key, null);
});

test('concurrent requests serialize rotation and count each rest once', async () => {
  const stored = {}, bg = background(rotationPack(), {}, stored);
  const responses = await Promise.all(Array.from({ length: 3 }, () =>
    select(bg, 'drunk:step:0', stepKeys(0), '1700000000000')));
  assert.equal(responses.filter(response => response.key).length, 1);
  assert.equal(stored.voiceRotation.sessionCount, 1);
  assert.equal(stored.voiceRotation.groups['drunk:step:0'].bag.length, 2);
});

test('fact frequencies off, every rest, and every fifth rest honor the selected cadence', async () => {
  for (const frequency of [0, 1, 5]) {
    const stored = {}, bg = background(rotationPack(), {}, stored);
    let factCount = 0;
    for (let n = 1; n <= 10; n++) {
      const id = String(1700000000000 + n);
      const result = await select(bg, 'day:step:0', stepKeys(0), id, facts, frequency);
      const isFact = facts.includes(result.key);
      assert.equal(isFact, frequency > 0 && n % frequency === 0);
      factCount += Number(isFact);
      assert.equal(stored.voiceRotation.sessions.at(-1).factsEvery, frequency);
    }
    assert.equal(factCount, frequency === 0 ? 0 : 10 / frequency);
  }
});

test('facts off stays silent and concurrent opening requests consume only one scheduled fact', async () => {
  const stored = {}, bg = background(rotationPack(), {}, stored), id = '1700000000001';
  const off = await select(bg, 'day:step:0', stepKeys(0), id, facts, 0);
  assert.ok(stepKeys(0).includes(off.key));
  assert.equal(stored.voiceRotation.sessions[0].factUsed, false);
  const responses = await Promise.all(Array.from({ length: 3 }, () =>
    select(bg, 'day:step:0', stepKeys(0), '1700000000002', facts, 1)));
  assert.equal(responses.filter(response => facts.includes(response.key)).length, 1);
  assert.equal(stored.voiceRotation.sessions[1].factUsed, true);
  for (const frequency of [-1, 4, '3', true])
    assert.equal((await select(bg, 'day:warn:0', stepKeys(0), undefined, undefined, frequency)).ok, false);
});

test('muted guidance still counts rests and permits a scheduled fact as the single opening', async () => {
  const stored = {}, bg = background(rotationPack(), {}, stored);
  for (let n = 1; n <= 6; n++) {
    const id = String(1700000000000 + n);
    const opening = await select(bg, 'day:step:0', [], id, facts, 3);
    assert.equal(facts.includes(opening.key), n % 3 === 0);
    if (n % 3 !== 0) assert.equal(opening.key, null);
    assert.equal(stored.voiceRotation.sessionCount, n);
    assert.equal(stored.voiceRotation.groups['day:step:0'], undefined);
    const blink = await select(bg, 'day:step:2', [], id, undefined, 3);
    assert.equal(blink.key, null);
    assert.equal(stored.voiceRotation.groups['day:step:2'], undefined);
  }
  assert.ok(stored.voiceRotation.groups['day:fact:0'].last);
});

test('all muted step and fact pools return null and preserve serialized session registration', async () => {
  const stored = {}, bg = background(rotationPack(), {}, stored), id = '1700000000001';
  const openings = await Promise.all(Array.from({ length: 3 }, () =>
    select(bg, 'day:step:0', [], id, [], 1)));
  assert.ok(openings.every(response => response.ok && response.key === null));
  assert.equal(stored.voiceRotation.sessionCount, 1);
  const silentBlink = await select(bg, 'day:step:2', [], id, undefined, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(silentBlink)), { ok: true, key: null });
  assert.equal(stored.voiceRotation.sessions[0].factUsed, false);
  assert.deepEqual(stored.voiceRotation.groups, {});
  const restarted = background(rotationPack(), {}, stored);
  await select(restarted, 'day:step:0', [], id, undefined, 1);
  assert.equal(stored.voiceRotation.sessionCount, 1);
  assert.equal((await select(restarted, 'day:warn:0', [])).ok, false);
  assert.equal(stored.voiceRotation.sessionCount, 1);
  assert.equal((await select(restarted, 'day:step:0', [], id, facts, 1)).key, null);
  assert.equal(stored.voiceRotation.sessions[0].factUsed, false);
  assert.ok(facts.includes((await select(restarted, 'day:step:0', [], '1700000000002', facts, 1)).key));
});

test('selection rejects malformed groups, sessions, keys and fact placement without saving', async () => {
  const stored = {}, bg = background(rotationPack(), {}, stored);
  for (const [group, keys, sessionId, factKeys] of [
    ['drunk:done:0', stepKeys(0)],
    ['drunk:step:4', stepKeys(0), '1700000000000'],
    ['drunk:step:0', stepKeys(0), 'abc'],
    ['drunk:step:0', stepKeys(0), 1700000000000],
    ['drunk:step:0', stepKeys(0), '17000000000000000'],
    ['day:warn:0', Array.from({ length: 65 }, () => 'vo_a0')],
    ['day:warn:0', ['vo_missing']],
    ['day:warn:0', ['../escape']],
    ['day:warn:0', []],
    ['drunk:step:2', stepKeys(2), '1700000000000', facts],
    ['drunk:step:0', stepKeys(0), '1700000000000', ['vo_missing']]
  ]) {
    const result = await select(bg, group, keys, sessionId, factKeys);
    assert.equal(result.ok, false, JSON.stringify([group, keys, sessionId]));
    assert.equal(stored.voiceRotation, undefined);
  }
  // Invalid requests must not poison the serialized queue.
  assert.equal((await select(bg, 'day:warn:0', stepKeys(0))).ok, true);
});

function popup(state = {}, cfg = {}, now, browser = {}) {
  const elements = new Map();
  const calls = { queries: [], messages: [], closes: 0, openedOptions: 0, createdTabs: 0, reloads: 0 };
  let saved = { state, cfg };
  const style = { setProperty() {} };
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      style, parentElement: { style: {} }, classList: { toggle() {} }, appendChild() {},
      setAttribute() {}, innerHTML: '', textContent: ''
    });
    return elements.get(id);
  };
  const context = {
    document: { getElementById: element, documentElement: { style },
      createElementNS: () => ({ setAttribute() {}, classList: { toggle() {} } }) },
    crypto: require('node:crypto').webcrypto, Date, setInterval() {}, window: { close() { calls.closes++; } },
    chrome: {
      tabs: {
        query: async query => {
          calls.queries.push(query);
          if (browser.queryError) throw new Error('Tab query failed');
          return browser.tabs === undefined ? [{ id: 42 }] : browser.tabs;
        },
        sendMessage: async (id, message) => {
          calls.messages.push({ id, message });
          if (browser.messageError) throw new Error('Receiving end does not exist');
          return Object.hasOwn(browser, 'reply') ? browser.reply : { ok: true, panelOpen: true };
        },
        create() { calls.createdTabs++; }, reload() { calls.reloads++; }
      },
      runtime: { openOptionsPage() { calls.openedOptions++; } },
      storage: { local: {
        get: async () => structuredClone(saved), set: async value => { saved = { ...saved, ...value }; }
      }, onChanged: { addListener() {} } }
    }
  };
  if (now) context.Date = clockAt(now);
  vm.createContext(context);
  vm.runInContext(sleepSource, context);
  vm.runInContext(preferencesSource, context);
  vm.runInContext(fs.readFileSync(path.join(root, 'popup.js'), 'utf8'), context);
  return { calls, element, read: () => saved, ready: () => new Promise(resolve => setImmediate(resolve)) };
}

test('popup Settings opens the current-tab panel and closes only after acknowledgement', async () => {
  const ui = popup();
  await ui.ready();
  await ui.element('b-set').onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(ui.calls.queries)), [{ active: true, currentWindow: true }]);
  assert.deepEqual(JSON.parse(JSON.stringify(ui.calls.messages)), [{ id: 42, message: { type: 'panel', open: true } }]);
  assert.equal(ui.calls.closes, 1);
  assert.equal(ui.element('settings-status').hidden, true);
  assert.equal(ui.calls.openedOptions, 0);
  assert.equal(ui.calls.createdTabs, 0);
  assert.equal(ui.calls.reloads, 0);
});

test('popup Settings failures stay open with guidance and never open or reload another tab', async () => {
  for (const browser of [
    { messageError: true }, { queryError: true }, { tabs: [] }, { tabs: [{}] },
    { reply: undefined }, { reply: null }, { reply: { ok: false } }
  ]) {
    const ui = popup({}, {}, undefined, browser);
    await ui.ready();
    await ui.element('b-set').onclick();
    assert.equal(ui.calls.closes, 0);
    assert.equal(ui.calls.openedOptions, 0);
    assert.equal(ui.calls.createdTabs, 0);
    assert.equal(ui.calls.reloads, 0);
    assert.equal(ui.element('settings-status').hidden, false);
    assert.equal(ui.element('settings-status').textContent,
      'Refresh this tab once after updating Blinkly, then try Settings again. Browser settings and extension-store pages do not allow the panel.');
  }
});

test('popup emits unique pause/resume/snooze events and records break skip', async () => {
  const ui = popup({ phase: 'break', days: {} });
  await ui.ready();
  await ui.element('b-snooze').onclick();
  let state = ui.read().state;
  assert.equal(state.phase, 'work');
  assert.equal(state.elapsed, 900);
  assert.equal(state.snoozeCount, 1);
  assert.equal(Object.values(state.days)[0].s, 1);
  assert.equal(state.voiceEvent.type, 'snooze');
  const id = state.voiceEvent.id;
  await ui.element('b-pause').onclick();
  assert.equal(ui.read().state.voiceEvent.type, 'pause');
  assert.notEqual(ui.read().state.voiceEvent.id, id);
  await ui.element('b-pause').onclick();
  assert.equal(ui.read().state.voiceEvent.type, 'resume');
});

test('popup countdown and snooze use effective bedtime intervals in frequent mode', async () => {
  const now = '2026-10-22T22:30:00Z'; // 04:00 IST
  for (const [mode, expected, elapsed] of [['voices', '19:00', 900], ['frequent', '9:00', 300]]) {
    const ui = popup({ phase: 'work', elapsed: 60 }, {
      workMin: 20, sleepMode: mode, sleepWorkMin: 10
    }, now);
    await ui.ready();
    assert.equal(ui.element('t').textContent, expected);
    await ui.element('b-snooze').onclick();
    assert.equal(ui.read().state.elapsed, elapsed);
    assert.equal(ui.element('t').textContent, '5:00');
  }
});

test('popup labels quiet hours and Break now explicitly starts a manual rest', async () => {
  const now = '2026-10-23T23:30:00Z';
  const ui = popup({ phase: 'work', elapsed: 60 }, { quietEnabled: true, sleepTimezone: 'UTC' }, now);
  await ui.ready();
  assert.equal(ui.element('l').textContent, 'Quiet hours');
  await ui.element('b-now').onclick();
  assert.equal(ui.read().state.manualBreak, true);
  assert.equal(ui.element('l').textContent, 'look 20 feet away');
});

test('strict popup hides and rejects snooze; break now keeps existing semantics', async () => {
  const ui = popup({ phase: 'work', elapsed: 100 }, { strict: true, breakSec: 30 });
  await ui.ready();
  assert.equal(ui.element('b-snooze').hidden, true);
  assert.equal(ui.element('b-snooze').parentElement.style.gridTemplateColumns, 'repeat(2,1fr)');
  await ui.element('b-snooze').onclick();
  assert.equal(ui.read().state.elapsed, 100);
  assert.equal(ui.read().state.snoozeCount, undefined);
  await ui.element('b-now').onclick();
  const state = ui.read().state;
  assert.equal(state.phase, 'break');
  assert.equal(state.manualBreak, true);
  assert.equal(state.breakLen, 30);
  assert.ok(state.breakEnd > Date.now());
  assert.equal(state.voiceEvent, undefined);
});

test('options loads shared lines before the runtime and all icons are restored', () => {
  const html = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
  assert.ok(html.indexOf('src="voice-lines.js"') < html.indexOf('src="blinkly.user.js"'));
  const popupHtml = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
  assert.ok(popupHtml.indexOf('src="sleep-schedule.js"') < popupHtml.indexOf('src="popup.js"'));
  assert.ok(popupHtml.indexOf('src="reminder-preferences.js"') < popupHtml.indexOf('src="popup.js"'));
  for (const size of [16, 32, 48, 128])
    assert.ok(fs.statSync(path.join(root, `icons/icon${size}.png`)).size > 0);
});


test('nickname avoidance persists across rests, alerts, and worker restarts', async () => {
  const pack = rotationPack(), stored = {};
  for (const step of [0]) {
    pack.clips[`vo_a${step}`].pet = 'Babe';
    pack.clips[`vo_b${step}`].pet = 'Babe';
    pack.clips[`vo_c${step}`].pet = 'Honey';
  }
  let lastPet = '';
  for (let round = 0; round < 12; round++) {
    const bg = background(pack, {}, stored);
    const group = round % 2 ? 'day:warn:0' : 'day:step:0';
    const response = await select(bg, group, stepKeys(0), String(1700000000000 + round));
    assert.equal(response.ok, true);
    const pet = pack.clips[response.key].pet.toLowerCase();
    assert.notEqual(pet, lastPet);
    assert.equal(stored.voiceRotation.lastPet, pet);
    lastPet = pet;
  }
});

test('a sole favorite does not repeat its nickname until a different nickname is spoken', async () => {
  const pack = rotationPack(), stored = {};
  pack.clips.vo_a0.pet = 'Babe'; pack.clips.vo_b0.pet = 'Honey';
  const bg = background(pack, {}, stored);
  const first = await select(bg, 'day:warn:0', ['vo_a0']);
  const second = await select(bg, 'day:warn:0', ['vo_a0']);
  assert.equal(first.key, 'vo_a0'); assert.equal(second.key, null);
  assert.equal((await select(bg, 'day:warn:0', ['vo_b0'])).key, 'vo_b0');
  assert.equal((await select(bg, 'day:warn:0', ['vo_a0'])).key, 'vo_a0');
});

test('twenty-second rest selections remain single across tabs, time contexts and worker restarts', async () => {
  const pack = rotationPack(), stored = {}, id = '1700000000000';
  const first = background(pack, {}, stored);
  assert.ok((await select(first, 'day:step:0', stepKeys(0), id, facts, 0, 20)).key);
  for (const group of ['day:step:0', 'night:step:0', 'drunk:step:0']) {
    const restarted = background(pack, {}, stored);
    assert.equal((await select(restarted, group, stepKeys(0), id, facts, 1, 120)).key, null);
    assert.equal((await select(restarted, 'day:step:2', stepKeys(2), id, undefined, 0, 120)).key, null,
      'a later duration cannot enlarge an existing rest');
  }
  assert.equal(stored.voiceRotation.sessionCount, 1);
  assert.equal(Object.values(stored.voiceRotation.sessions[0].selectedSteps).filter(Boolean).length, 1);
  assert.equal(Object.keys(stored.voiceRotation.groups).length, 1);
});

test('a long rest keeps its nickname, falls back to neutral, or stays silent instead of changing names', async () => {
  for (const [laterKeys, expected] of [
    [['vo_a2', 'vo_b2', 'vo_c2'], 'vo_a2'],
    [['vo_b2', 'vo_c2'], 'vo_c2'],
    [['vo_b2'], null]
  ]) {
    const pack = rotationPack(), stored = {}, id = '1700000000000';
    pack.clips.vo_a0.pet = 'Babe'; pack.clips.vo_a2.pet = 'babe'; pack.clips.vo_b2.pet = 'Honey';
    const bg = background(pack, {}, stored);
    assert.equal((await select(bg, 'day:step:0', ['vo_a0'], id, undefined, 0, 40, 'balanced')).key, 'vo_a0');
    assert.equal((await select(background(pack, {}, stored), 'night:step:2', laterKeys, id, undefined, 0, 40, 'balanced')).key, expected);
    assert.equal((await select(bg, 'day:step:2', laterKeys, id, undefined, 0, 40, 'balanced')).key, null);
    assert.ok(Object.values(stored.voiceRotation.sessions[0].selectedSteps).filter(Boolean).length <= 2);
    assert.equal(stored.voiceRotation.sessions[0].pet, 'babe');
  }
});

test('a neutral opening does not introduce a nickname in a later long-rest prompt', async () => {
  const pack = rotationPack(), stored = {}, id = '1700000000000';
  pack.clips.vo_a2.pet = 'Babe';
  const bg = background(pack, {}, stored);
  await select(bg, 'day:step:0', ['vo_a0'], id, undefined, 0, 60, 'balanced');
  assert.equal((await select(bg, 'day:step:2', ['vo_a2', 'vo_c2'], id, undefined, 0, 60, 'balanced')).key, 'vo_c2');
});

test('invalid duration is rejected and old session records cannot replay their opening', async () => {
  const pack = rotationPack();
  for (const duration of [0, 9, 121, NaN, Infinity, '40', null]) {
    const stored = {}, bg = background(pack, {}, stored);
    assert.equal((await select(bg, 'day:step:0', stepKeys(0), '1700000000000', undefined, 0, duration)).ok, false);
    assert.equal(stored.voiceRotation, undefined);
  }
  const stored = { voiceRotation: { schema: 1, groups: {}, sessionCount: 1,
    sessions: [{ id: '1700000000000', factDue: false, factUsed: false }] } };
  const bg = background(pack, {}, stored);
  assert.equal((await select(bg, 'day:step:0', stepKeys(0), '1700000000000')).key, null);
  assert.equal((await select(bg, 'day:step:2', stepKeys(2), '1700000000000', undefined, 0, 60)).key, null);
});

test('balanced twenty-second mode permits two prompts by default while quiet stays at one', async () => {
  for (const restGuidance of [undefined, 'balanced', 'quiet']) {
    const stored = {}, bg = background(rotationPack(), {}, stored), sessionId = '1700000000000';
    const request = step => bg.request({ type: 'blinkly-select-clip', group: `day:step:${step}`, keys: stepKeys(step),
      sessionId, duration: 20, factsEvery: 0, ...(restGuidance === undefined ? {} : { restGuidance }) }, { tab: { id: 42 } });
    const responses = [];
    for (const step of [0, 1, 2, 3, 0, 2]) responses.push(await request(step));
    assert.equal(responses.filter(response => response.key).length, restGuidance === 'quiet' ? 1 : 2);
    assert.equal(stored.voiceRotation.sessions[0].restGuidance, restGuidance || 'balanced');
    const opposite = restGuidance === 'quiet' ? 'balanced' : 'quiet';
    assert.equal((await select(background(rotationPack(), {}, stored), 'day:step:2', stepKeys(2), sessionId,
      undefined, 0, 20, opposite)).key, null, 'changing the mode cannot replay an already-consumed slot');
  }
  const stored = {}, bg = background(rotationPack(), {}, stored), sessionId = '1700000000001';
  await select(bg, 'day:step:0', stepKeys(0), sessionId, undefined, 0, 10, 'balanced');
  assert.equal((await select(bg, 'day:step:2', stepKeys(2), sessionId, undefined, 0, 20, 'balanced')).key, null);
});

const react = (bg, event, actionId, keys, sessionId, period = 'day') => bg.request({
  type: 'blinkly-select-clip', group: `${period}:${event}:0`, keys, actionId,
  ...(sessionId === undefined ? {} : { sessionId })
}, { tab: { id: 42 } });

test('snooze and completion reactions deduplicate action ids across concurrent tabs and worker restarts', async () => {
  const pack = rotationPack(), stored = {}, bg = background(pack, {}, stored), sessionId = '1700000000000';
  await select(bg, 'day:step:0', stepKeys(0), sessionId);
  const snoozes = await Promise.all(Array.from({ length: 4 }, () => react(bg, 'snooze', 'snooze:action-1', stepKeys(1), sessionId)));
  assert.equal(snoozes.filter(response => response.key).length, 1);
  assert.equal((await react(background(pack, {}, stored), 'snooze', 'snooze:action-1', stepKeys(1), sessionId, 'drunk')).key, null);
  assert.equal((await react(bg, 'done', 'snooze:action-1', stepKeys(3), sessionId)).key, null, 'action id is global across reaction groups');
  const done = await react(bg, 'done', `done:${sessionId}`, stepKeys(3), sessionId);
  assert.ok(stepKeys(3).includes(done.key));
  assert.equal((await react(background(pack, {}, stored), 'done', `done:${sessionId}`, stepKeys(3), sessionId)).key, null);
  assert.deepEqual(stored.voiceRotation.actions.map(action => action.id), ['snooze:action-1', `done:${sessionId}`]);
});

test('rest reactions preserve a known nickname or use neutral recordings, including across restart', async () => {
  for (const event of ['snooze', 'done']) for (const [keys, expected] of [
    [['vo_a3', 'vo_b3', 'vo_c3'], 'vo_a3'], [['vo_b3', 'vo_c3'], 'vo_c3'], [['vo_b3'], null]
  ]) {
    const pack = rotationPack(), stored = {}, sessionId = '1700000000000';
    pack.clips.vo_a0.pet = 'Babe'; pack.clips.vo_a3.pet = 'Babe'; pack.clips.vo_b3.pet = 'Honey';
    await select(background(pack, {}, stored), 'day:step:0', ['vo_a0'], sessionId);
    const response = await react(background(pack, {}, stored), event, `${event}:${sessionId}`, keys, sessionId);
    assert.equal(response.key, expected);
    assert.equal((await react(background(pack, {}, stored), event, `${event}:${sessionId}`, keys, sessionId)).key, null);
  }
});

test('neutral-rest reactions stay neutral and snoozing outside a rest can select a fresh nickname', async () => {
  const pack = rotationPack(), stored = {}, sessionId = '1700000000000';
  pack.clips.vo_a3.pet = 'Honey';
  const bg = background(pack, {}, stored);
  await select(bg, 'day:step:0', ['vo_a0'], sessionId);
  assert.equal((await react(bg, 'done', 'done:neutral', ['vo_a3', 'vo_c3'], sessionId)).key, 'vo_c3');
  assert.equal((await react(bg, 'snooze', 'snooze:outside', ['vo_a3'])).key, 'vo_a3');
  assert.equal((await react(bg, 'snooze', 'snooze:outside-again', ['vo_a3'])).key, null, 'outside-rest snooze follows global nickname rotation');
});

test('invalid reaction identities, placement, sessions and guidance fail without mutating saved state', async () => {
  const invalid = [
    { group: 'day:snooze:1', actionId: 'one' }, { group: 'day:done:2', actionId: 'one', sessionId: '123' },
    ...[undefined, '', 'has space', 'x'.repeat(161), 123, '../one'].map(actionId => ({ group: 'day:snooze:0', actionId })),
    { group: 'day:done:0', actionId: 'done:one' },
    { group: 'day:done:0', actionId: 'done:one', sessionId: 'abc' },
    { group: 'day:snooze:0', actionId: 'one', sessionId: 123 },
    { group: 'day:step:0', sessionId: '123', restGuidance: 'loud' },
    { group: 'day:snooze:0', actionId: 'one', factKeys: facts }
  ];
  for (const message of invalid) {
    const stored = {}, bg = background(rotationPack(), {}, stored);
    const response = await bg.request({ type: 'blinkly-select-clip', keys: stepKeys(0), ...message }, { tab: { id: 42 } });
    assert.equal(response.ok, false, JSON.stringify(message)); assert.equal(stored.voiceRotation, undefined);
  }
});

test('muted reactions consume their action once and reaction history is bounded', async () => {
  const pack = rotationPack(), stored = {}, bg = background(pack, {}, stored);
  assert.equal((await react(bg, 'snooze', 'silent', [])).key, null);
  assert.equal((await react(bg, 'snooze', 'silent', stepKeys(0))).key, null);
  for (let index = 0; index < 130; index++) await react(bg, 'snooze', `action:${index}`, []);
  assert.equal(stored.voiceRotation.actions.length, 128);
  assert.equal(stored.voiceRotation.actions[0].id, 'action:2');
});

test('pet-name preference selects named alerts, openings and scheduled facts from mixed pools', async () => {
  const pack = rotationPack(), stored = {}, bg = background(pack, {}, stored);
  for (const suffix of ['0', 'fact']) {
    if (suffix === '0') { pack.clips.vo_a0.pet = 'Babe'; pack.clips.vo_b0.pet = 'Honey'; }
    else { pack.clips.vo_facta.pet = 'Babe'; pack.clips.vo_factb.pet = 'Honey'; }
  }
  const request = message => bg.request({ type: 'blinkly-select-clip', preferPetNames: true, ...message }, { tab: { id: 42 } });
  for (let round = 0; round < 9; round++) {
    const warning = await request({ group: 'day:warn:0', keys: stepKeys(0) });
    assert.ok(['vo_a0', 'vo_b0'].includes(warning.key));
    const opening = await request({ group: 'day:step:0', keys: stepKeys(0), sessionId: String(1700000000000 + round),
      factKeys: facts, factsEvery: 3, duration: 20, restGuidance: 'balanced' });
    assert.ok((round % 3 === 2 ? ['vo_facta', 'vo_factb'] : ['vo_a0', 'vo_b0']).includes(opening.key));
    assert.ok(pack.clips[opening.key].pet, 'selected line speaks a pet name');
  }
});

test('pet-name preference leaves neutral pools rotating and remains optional', async () => {
  for (const preferPetNames of [undefined, false, true]) {
    const pack = rotationPack(), stored = {}, bg = background(pack, {}, stored), selected = [];
    for (let round = 0; round < 3; round++) {
      const response = await bg.request({ type: 'blinkly-select-clip', group: 'day:warn:0', keys: stepKeys(0),
        ...(preferPetNames === undefined ? {} : { preferPetNames }) }, { tab: { id: 42 } });
      selected.push(response.key);
    }
    assert.equal(new Set(selected).size, 3, 'neutral-only speech must keep its full rotation');
  }
  const pack = rotationPack(), stored = {}, bg = background(pack, {}, stored);
  pack.clips.vo_a0.pet = 'Babe';
  const keys = [];
  for (let round = 0; round < 3; round++) keys.push((await bg.request({ type: 'blinkly-select-clip',
    group: 'day:warn:0', keys: stepKeys(0), preferPetNames: false }, { tab: { id: 42 } })).key);
  assert.equal(new Set(keys).size, 3, 'disabled preference does not remove neutral variants');
});

test('pet-name preference never changes the recipient name for follow-up prompts or rest reactions', async () => {
  for (const keys of [['vo_a2', 'vo_b2', 'vo_c2'], ['vo_b2', 'vo_c2']]) {
    const pack = rotationPack(), stored = {}, bg = background(pack, {}, stored), sessionId = '1700000000000';
    pack.clips.vo_a0.pet = 'Babe'; pack.clips.vo_a2.pet = 'Babe'; pack.clips.vo_b2.pet = 'Honey';
    const request = message => bg.request({ type: 'blinkly-select-clip', preferPetNames: true, ...message }, { tab: { id: 42 } });
    assert.equal((await request({ group: 'day:step:0', keys: ['vo_a0', 'vo_c0'], sessionId, duration: 20, factsEvery: 0 })).key, 'vo_a0');
    assert.equal((await request({ group: 'day:step:2', keys, sessionId, duration: 20 })).key,
      keys.includes('vo_a2') ? 'vo_a2' : 'vo_c2');
    assert.equal((await request({ group: 'day:done:0', keys: ['vo_b2', 'vo_c2'], sessionId, actionId: 'done:one' })).key, 'vo_c2');
  }
});

test('pet-name preference requires a real boolean and rejects invalid flags before saving', async () => {
  for (const preferPetNames of ['true', 'false', 0, 1, null, {}, []]) {
    const stored = {}, bg = background(rotationPack(), {}, stored);
    const response = await bg.request({ type: 'blinkly-select-clip', group: 'day:warn:0', keys: stepKeys(0), preferPetNames }, { tab: { id: 42 } });
    assert.equal(response.ok, false); assert.match(response.error, /pet-name preference/);
    assert.equal(stored.voiceRotation, undefined);
  }
});

test('hardcoded recorded pet names cannot change during a longer rest', async () => {
  const pack = rotationPack(), stored = {};
  Object.assign(pack.clips.vo_a0, { text: '[softly] Daddy, look far away.', mood: 'flirty', pet: null });
  Object.assign(pack.clips.vo_a2, { text: '[softly] Blink for me, handsome.', mood: 'flirty', pet: null });
  Object.assign(pack.clips.vo_b2, { text: '[softly] A slow blink, Daddy.', mood: 'flirty', pet: null });
  const request = (bg, step, keys, id) => bg.request({ type:'blinkly-select-clip', group:`day:step:${step}`, keys, sessionId:id, duration:40, factsEvery:0 }, { tab:{id:42} });
  const bg = background(pack, {}, stored);
  await request(bg, 0, ['vo_a0'], '1700000000200');
  assert.equal((await request(bg, 2, ['vo_a2','vo_b2'], '1700000000200')).key, 'vo_b2');
  assert.equal(stored.voiceRotation.sessions.at(-1).pet, 'daddy');
});
