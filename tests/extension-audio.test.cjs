const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../extension-audio.js');
const { create: createPlayer } = require('../audio-player.js');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const sender = id => ({ tab: { id }, id: 'blinkly' });
const request = (token = 't1', key = 'vo_abc') => ({ key, token, volume: 0.6 });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture(extra = {}) {
  const pending = new Map(), calls = [], listeners = {};
  const event = name => ({ addListener: fn => { listeners[name] = fn; } });
  const player = {
    play(message) { calls.push(['play', message]); const d = deferred(); pending.set(message.token, d); return d.promise; },
    stop(message) { calls.push(['stop', message]); pending.get(message.token)?.resolve({ ok: true, started: true, canceled: true }); return Promise.resolve({ ok: true, stopped: true }); },
    status(message) { return { ok: true, playing: pending.has(message.token), started: pending.has(message.token) }; }
  };
  const api = { runtime: { getURL: path => `moz-extension://blinkly/${path}` }, tabs: { onActivated: event('activated'), onRemoved: event('removed'), onUpdated: event('updated') }, windows: { onFocusChanged: event('focus') } };
  const service = create({ api, canSpeak: async () => true, getClip: async key => ({ file: `audio/${key}.mp3` }), playerFactory: () => player, ...extra });
  return { service, player, pending, calls, listeners, api };
}
test('a newer tab replaces global playback; stale stop cannot cancel it', async () => {
  const f = fixture();
  const old = f.service.play(request('old'), sender(1)); await flush();
  const next = f.service.play(request('next'), sender(2)); await flush();
  assert.equal((await old).canceled, true);
  assert.equal((await f.service.stop({ token: 'old' }, sender(1))).stopped, false);
  assert.equal((await f.service.stop({ token: 'next' }, sender(1))).stopped, false);
  assert.equal((await f.service.status({ token: 'next' }, sender(2))).playing, true);
  f.pending.get('next').resolve({ ok: true, started: true, canceled: false, duration: 3 });
  assert.equal((await next).duration, 3);
});
test('stop cancels an authorization/pack read before it can dispatch audio', async () => {
  const read = deferred(), f = fixture({ getClip: () => read.promise });
  const result = f.service.play(request(), sender(1));
  assert.equal((await f.service.stop({ token: 't1' }, sender(1))).stopped, true);
  read.resolve({ file: 'audio/vo_abc.mp3' });
  assert.equal((await result).canceled, true);
  assert.equal(f.calls.length, 0);
});
test('concurrent offscreen initialization creates one document and canceled request never plays', async () => {
  const created = deferred(), calls = [];
  let creates = 0;
  const api = { runtime: { getURL: path => `chrome-extension://blinkly/${path}`, sendMessage: async m => { calls.push(m); return { ok: true, started: true, canceled: false }; } },
    offscreen: { hasDocument: async () => false, createDocument: () => { creates++; return created.promise; } } };
  const f = fixture({ api });
  const old = f.service.play(request('old'), sender(1)); await flush();
  const next = f.service.play(request('next'), sender(2)); await flush();
  assert.equal(creates, 1);
  created.resolve();
  assert.equal((await old).canceled, true);
  assert.equal((await next).started, true);
  assert.deepEqual(calls.filter(m => m.action === 'play').map(m => m.token), ['next']);
});
test('focus is checked again after offscreen creation', async () => {
  let allowed = true;
  const created = deferred(), calls = [];
  const api = { runtime: { getURL: p => p, sendMessage: async m => { calls.push(m); return {}; } }, offscreen: { hasDocument: async () => false, createDocument: () => created.promise } };
  const f = fixture({ api, canSpeak: async () => allowed });
  const playing = f.service.play(request(), sender(1)); await flush(); allowed = false; created.resolve();
  assert.equal((await playing).canceled, true);
  assert.equal(calls.some(m => m.action === 'play'), false);
});
test('focus loss and navigation cancel currently playing audio', async () => {
  let allowed = true;
  const f = fixture({ canSpeak: async () => allowed }); f.service.attach();
  const first = f.service.play(request('first'), sender(1)); await flush();
  allowed = false; await f.listeners.focus(-1);
  assert.equal((await first).canceled, true);
  allowed = true;
  const second = f.service.play(request('second'), sender(1)); await flush();
  f.listeners.updated(1, { status: 'loading' });
  assert.equal((await second).canceled, true);
});
test('invalid clip paths, foreign URLs, mixed chime requests and missing pack entries fail closed', async () => {
  const f = fixture();
  for (const key of ['../../secret', 'https://x.test/a.mp3', 'vo_a.mp3', 'vo_UPPER'])
    assert.equal((await f.service.play(request('t', key), sender(1))).ok, false);
  assert.equal((await f.service.play({ ...request(), chime: '../bad' }, sender(1))).ok, false);
  const missing = fixture({ getClip: async () => ({ file: 'https://x.test/a.mp3' }) });
  assert.equal((await missing.service.play(request(), sender(1))).ok, false);
  assert.equal(f.calls.length, 0);
});
test('trusted extension options can be authorized by caller; target player messages are ignored', async () => {
  const f = fixture({ canSpeak: async s => !s.tab && s.url === 'moz-extension://blinkly/options.html' });
  const result = f.service.play(request(), { url: 'moz-extension://blinkly/options.html' }); await flush();
  f.pending.get('t1').resolve({ ok: true, started: true, canceled: false });
  assert.equal((await result).started, true);
  assert.equal(f.service.handle({ target: 'blinkly-audio-player', action: 'play' }, sender(1)), undefined);
});
test('fixed chimes do not require a voice manifest entry', async () => {
  const f = fixture({ getClip: () => { throw Error('must not read'); } });
  const result = f.service.play({ chime: 'start', token: 'chime', volume: 0.2 }, sender(1)); await flush();
  assert.equal(f.calls[0][1].chime, 'start');
  f.pending.get('chime').resolve({ ok: true, started: true, canceled: false }); await result;
});
function audioFixture() {
  const audios = [];
  class Audio {
    constructor(url) { this.url = url; this.duration = 2.5; this.start = deferred(); audios.push(this); }
    play() { return this.start.promise; }
    pause() { this.paused = true; }
    removeAttribute() { this.removed = true; }
    load() { this.loaded = true; }
  }
  const player = createPlayer({ Audio, getURL: path => `chrome-extension://blinkly/${path}` });
  return { player, audios };
}
test('player uses only bundled paths and resolves successful completion with actual start', async () => {
  const f = audioFixture(), result = f.player.play(request());
  assert.equal(f.audios[0].url, 'chrome-extension://blinkly/audio/vo_abc.mp3');
  f.audios[0].start.resolve(); await flush();
  assert.equal(f.player.status({ token: 't1' }).started, true);
  f.audios[0].onended();
  assert.deepEqual(await result, { ok: true, started: true, canceled: false, duration: 2.5 });
});
test('player reports autoplay errors, and canceled late play rejection cannot affect replacement', async () => {
  const f = audioFixture();
  const first = f.player.play(request('old'));
  const second = f.player.play(request('next'));
  assert.equal((await first).canceled, true);
  f.audios[0].start.reject(Error('late blocked'));
  f.audios[1].start.resolve(); await flush();
  assert.equal(f.player.status({ token: 'next' }).started, true);
  assert.equal(f.player.stop({ token: 'old' }).stopped, false);
  f.audios[1].onended(); assert.equal((await second).ok, true);
  const blocked = f.player.play(request('blocked')); f.audios[2].start.reject(Error('blocked'));
  assert.equal((await blocked).ok, false);
});
test('player rejects arbitrary source paths and invalid volume before constructing audio', async () => {
  const f = audioFixture();
  for (const message of [{ ...request(), key: '../foo' }, { ...request(), volume: NaN }, { ...request(), volume: 2 }, { ...request(), chime: 'end' }])
    assert.equal((await f.player.play(message)).ok, false);
  assert.equal(f.audios.length, 0);
  const result = f.player.play({ chime: 'end', token: 'end', volume: 0.4 });
  assert.equal(f.audios[0].url, 'chrome-extension://blinkly/audio/chime-end.wav');
  f.player.stop({ token: 'end' }); await result;
});
test('unauthorized late requests cannot silence an authorized foreground recording', async () => {
  const f = fixture({ canSpeak: async s => s.tab.id === 1 });
  const first = f.service.play(request('foreground'), sender(1)); await flush();
  const hidden = await f.service.play(request('hidden'), sender(2));
  assert.equal(hidden.canceled, true);
  assert.equal((await f.service.status({ token: 'foreground' }, sender(1))).playing, true);
  assert.equal(f.calls.filter(call => call[0] === 'stop').length, 0);
  f.pending.get('foreground').resolve({ ok: true, started: true, canceled: false }); await first;
});
test('an old delayed authorization cannot replace a newer authorized recording', async () => {
  const delayed = deferred();
  const f = fixture({ canSpeak: async s => s.tab.id === 1 ? delayed.promise : true });
  const first = f.service.play(request('old'), sender(1));
  const next = f.service.play(request('next'), sender(2)); await flush();
  delayed.resolve(true);
  assert.equal((await first).canceled, true);
  assert.equal((await f.service.status({ token: 'next' }, sender(2))).playing, true);
  assert.equal(f.calls.filter(c => c[0] === 'play').length, 1);
  f.pending.get('next').resolve({ ok: true, started: true, canceled: false }); await next;
});
test('offscreen creation failures are reported and a later play retries initialization', async () => {
  let attempts = 0;
  const api = { runtime: { getURL: p => p, sendMessage: async () => ({ ok: true, started: true, canceled: false }) },
    offscreen: { hasDocument: async () => false, createDocument: async () => { if (++attempts === 1) throw Error('Cannot create document'); } } };
  const f = fixture({ api });
  assert.equal((await f.service.play(request('failed'), sender(1))).ok, false);
  assert.equal((await f.service.play(request('retry'), sender(1))).started, true);
  assert.equal(attempts, 2);
});
test('player listener ignores direct content messages targeting the offscreen player', () => {
  const { install } = require('../audio-player.js');
  let listener;
  const api = { runtime: { id: 'blinkly', getURL: p => p, onMessage: { addListener: fn => { listener = fn; } } } };
  install(api);
  const respond = () => { throw Error('must not handle'); };
  assert.equal(listener({ target: 'blinkly-audio-player', action: 'play', ...request() }, sender(1), respond), undefined);
  assert.equal(listener({ target: 'blinkly-audio-player', action: 'play', ...request() }, { id: 'foreign' }, respond), undefined);
});
