'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../blinkly.user.js'), 'utf8');
const worker = fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8');
const pumpSource = source.slice(source.indexOf('  async function pump()'), source.indexOf('  function say('));

test('packaged guidance starts without creating or unlocking website audio', async () => {
  const calls = [];
  const context = vm.createContext({ vBusy: false, vPending: { text: 'rest', epoch: 0, force: false, context: null },
    vEpoch: 0, extensionPlayback: true, vCur: null, playbackSequence: 0, ME: 'page',
    Voice: { key: () => 'vo_rest' }, cfg: { voiceVol: .8 }, S: { phase: 'break', breakEnd: 20000 },
    voiceAllowed: () => true, playbackContext: () => { throw Error('Website audio must not be used'); },
    packMessage: async message => { calls.push(message); return { ok: true, allowed: true, started: true }; },
    vstat() {}, renderLibrary() {}, previewKey: null, Date });
  vm.runInContext(pumpSource, context);
  await context.pump();
  assert.equal(calls.filter(call => call.type === 'blinkly-audio-play').length, 1);
  assert.equal(calls.find(call => call.type === 'blinkly-audio-play').sessionId, '20000');
  assert.equal(context.vCur, null);
});

test('leaving the page stops only its own extension audio token', () => {
  const calls = [];
  const context = vm.createContext({ vEpoch: 3, vPending: {}, blockedVoice: {}, previewRequest: {}, vDelay: null,
    previewKey: null, vCur: { remote: true, token: 'page:3:1' }, clearTimeout() {},
    packMessage: async message => { calls.push(message); return { ok: true }; },
    audio: { peek() { throw Error('Page audio context must not be touched'); } } });
  const stopSource = source.slice(source.indexOf('  function stopVoice()'), source.indexOf('  async function voiceEvent('));
  vm.runInContext(stopSource, context); context.stopVoice();
  assert.equal(context.vEpoch, 4); assert.equal(context.vCur, null);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ type: 'blinkly-audio-stop', token: 'page:3:1' }]);
});

function authorization(cfg, state, focused = true) {
  const context = vm.createContext({ chrome: { runtime: { getURL: name => 'chrome-extension://blinkly/' + name },
    storage: { local: { get: async () => ({ cfg, state }) } } },
    canSpeak: async () => focused, Sleep: { defaults: {} },
    Preferences: { defaults: {}, quietNow: c => !!c.quietEnabled }, Date: { now: () => 1000 } });
  vm.runInContext(worker.slice(worker.indexOf('async function allowAudio('), worker.indexOf('const extensionAudio =')), context);
  return context.allowAudio;
}
test('voice player authorizes the current rest, honors mute and quiet hours, and rejects stale requests', async () => {
  const sender = { tab: { id: 5 } }, request = { event: 'step', sessionId: '2000' };
  const state = { phase: 'break', breakEnd: 2000, manualBreak: false };
  assert.equal(await authorization({}, state)(sender, request), true);
  assert.equal(await authorization({ voiceOn: false }, state)(sender, request), false);
  assert.equal(await authorization({ quietEnabled: true }, state)(sender, request), false);
  assert.equal(await authorization({ quietEnabled: true }, { ...state, manualBreak: true })(sender, request), true);
  assert.equal(await authorization({}, state, false)(sender, request), false);
  assert.equal(await authorization({}, state)(sender, { ...request, sessionId: '1999' }), false);
  assert.equal(await authorization({}, { ...state, breakEnd: 500 })(sender, { ...request, sessionId: '500' }), false);
});
test('previews are allowed from the foreground page or actual settings page only', async () => {
  const allow = authorization({ voiceOn: false }, {}, false);
  assert.equal(await allow({ url: 'chrome-extension://blinkly/options.html' }, { preview: true }), true);
  assert.equal(await allow({ url: 'https://example.com/options.html' }, { preview: true }), false);
  assert.equal(await allow({ url: 'chrome-extension://blinkly/options.html' }, { event: 'step' }), false);
});
test('snooze and Rested responses must match the shared current action', async () => {
  const sender = { tab: { id: 5 } };
  const state = { phase: 'work', res: 'done', resAt: 900, resUntil: 2000, voiceEvent: { id: 'action', at: 900 } };
  const done = { event: 'done', actionId: 'action' };
  assert.equal(await authorization({}, state)(sender, done), true);
  assert.equal(await authorization({ voiceDone: false }, state)(sender, done), false);
  assert.equal(await authorization({}, state)(sender, { ...done, actionId: 'old' }), false);
  assert.equal(await authorization({}, state)(sender, { event: 'snooze', actionId: 'action' }), true);
  assert.equal(await authorization({ voiceSnooze: false }, state)(sender, { event: 'snooze', actionId: 'action' }), false);
});
test('completion event processing cannot immediately cancel the fallback end chime', () => {
  const calls = [];
  const context = vm.createContext({ S: { phase: 'break', breakEnd: 2000 }, ME: 'page', Store: { coordinated: true },
    cfg: { voiceOn: false, voiceDone: false }, PAGE: false, freshState: () => ({}),
    stopVoice: () => calls.push('stop'), externalVoiceEvent: () => calls.push('stop'),
    chime: kind => calls.push(kind), render() {} });
  vm.runInContext(source.slice(source.indexOf('  function receiveState('), source.indexOf('  Store.on(')), context);
  context.receiveState({ timerSchema: 1, revision: 2, w: 'worker', phase: 'work', res: 'done' });
  assert.equal(calls.at(-1), 'end');
});
