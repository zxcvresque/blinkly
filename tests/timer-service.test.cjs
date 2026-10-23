'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Timer = require('../timer-service.js');
const Sleep = require('../sleep-schedule.js');
const Preferences = require('../reminder-preferences.js');
function fixture(state = {}, cfg = {}) {
  let time = Date.parse('2026-10-23T12:00:00Z'), active = 42;
  const stored = { state: { lastAct: time, ...state }, cfg: { sleepEnabled: false, ...cfg } }, writes = [];
  const storage = {
    get: async keys => Object.fromEntries(keys.filter(k => k in stored).map(k => [k, structuredClone(stored[k])])),
    set: async values => { writes.push(structuredClone(values)); Object.assign(stored, structuredClone(values)); }
  };
  const create = () => Timer.create({ storage, sleep: Sleep, preferences: Preferences, now: () => time, activeTab: async () => active });
  let service = create();
  return { stored, writes, now: () => time, advance: ms => { time += ms; }, active: id => { active = id; },
    restartWorker: () => { service = create(); },
    request: (action, extra = {}, tab = 42) => service.request({ action, ...extra }, { tab: { id: tab } }) };
}
test('one serialized clock advances once when two tabs heartbeat together and switch focus', async () => {
  const f = fixture();
  let replies = await Promise.all([f.request('tick'), f.request('tick'), f.request('tick', {}, 43)]);
  assert.deepEqual(replies.map(r => r.state.elapsed), [1, 1, 1]);
  f.active(43); // The second document adopts the same shared time, not a new interval.
  assert.equal((await f.request('tick', {}, 43)).state.elapsed, 1);
  f.advance(1000);
  replies = await Promise.all([f.request('tick'), f.request('tick', {}, 43), f.request('tick', {}, 43)]);
  assert.deepEqual(replies.map(r => r.state.elapsed), [1, 2, 2]);
  assert.equal(Object.values(f.stored.state.days)[0].a, 2);
});
test('the authoritative timer survives page reloads, worker restart, and stale legacy tab writes', async () => {
  const f = fixture({ elapsed: 127 });
  await f.request('tick'); f.advance(1000); await f.request('tick');
  const expected = structuredClone(f.stored.timerState);
  f.stored.state = { phase: 'work', elapsed: 0, w: 'old-tab' };
  f.restartWorker();
  assert.deepEqual((await f.request('snapshot', {}, 43)).state, expected);
  assert.deepEqual(f.stored.state, expected, 'the popup and badge mirror are repaired too');
  assert.equal((await f.request('tick', {}, 43)).state.elapsed, 129);
});
test('hidden tabs and an unfocused browser cannot advance or reset the work timer', async () => {
  const f = fixture({ elapsed: 60 });
  f.active(null); f.advance(1000);
  assert.equal((await f.request('tick')).state.elapsed, 60);
  f.advance(121000);
  assert.equal((await f.request('activity')).resetAfterIdle, false);
  assert.equal(f.stored.timerState.elapsed, 60);
  f.active(42);
  assert.equal((await f.request('activity')).resetAfterIdle, true);
  assert.equal(f.stored.timerState.elapsed, 0);
});
test('pause, snooze, and restart operate on the newest state across clients', async () => {
  const f = fixture({ elapsed: 300 });
  await f.request('pause'); f.advance(3000);
  assert.equal((await f.request('tick')).state.elapsed, 300);
  f.restartWorker(); await f.request('pause', {}, 43);
  f.advance(1000); assert.equal((await f.request('tick')).state.elapsed, 301);
  await f.request('snooze', {}, 43);
  assert.equal(f.stored.timerState.elapsed, 900);
  await f.request('restart');
  assert.equal((await f.request('snapshot', {}, 43)).state.elapsed, 0);
});
test('concurrent manual starts share one deadline and completion is counted once', async () => {
  const f = fixture();
  const results = await Promise.all([f.request('start'), f.request('start', {}, 43)]);
  const sessionId = String(results[0].state.breakEnd);
  assert.equal(String(results[1].state.breakEnd), sessionId);
  f.advance(20000);
  await Promise.all([f.request('tick'), f.request('finish', { sessionId }, 43), f.request('finish', { sessionId })]);
  assert.equal(Object.values(f.stored.timerState.days)[0].d, 1);
  assert.equal(f.stored.timerState.voiceEvent.id, `done:${sessionId}`);
  assert.equal(f.stored.timerState.manualBreak, true, 'manual Rested replies remain allowed in quiet hours');
});
test('a stale completion or playback update cannot overwrite the next break', async () => {
  const f = fixture();
  const old = (await f.request('start')).state;
  await f.request('skip', { sessionId: String(old.breakEnd) }); f.advance(1000);
  const current = (await f.request('start')).state;
  await f.request('finish', { sessionId: String(old.breakEnd) });
  await f.request('presentation', { sessionId: String(old.breakEnd), resAt: 0, resUntil: f.now() + 9000 });
  assert.equal(f.stored.timerState.breakEnd, current.breakEnd);
  assert.equal(f.stored.timerState.phase, 'break');
});
test('completion presentation updates only its own Rested action and never timer progress', async () => {
  const f = fixture();
  const { state } = await f.request('start'); f.advance(20000);
  const done = (await f.request('finish', { sessionId: String(state.breakEnd) })).state;
  f.advance(1000); await f.request('tick');
  await f.request('presentation', { sessionId: String(done.breakEnd), resAt: done.resAt, resUntil: f.now() + 250 });
  assert.equal(f.stored.timerState.elapsed, 1);
  assert.equal(f.stored.timerState.resUntil, f.now() + 250);
});
test('scheduled warnings and automatic starts are single shared transitions', async () => {
  const f = fixture({ elapsed: 28 }, { workMin: 1, warnSec: 30 });
  await f.request('tick'); f.advance(1000);
  const warning = (await f.request('tick')).state.voiceEvent;
  assert.equal(warning.type, 'warn');
  await f.request('tick'); assert.equal(f.stored.timerState.voiceEvent.id, warning.id);
  for (let i = 0; i < 30; i++) { f.advance(1000); await f.request('tick'); }
  assert.equal(f.stored.timerState.phase, 'break'); assert.equal(f.stored.timerState.manualBreak, false);
});
test('quiet hours pause automatic reminders while manual rests still finish normally', async () => {
  const f = fixture({ elapsed: 59 }, { workMin: 1, quietEnabled: true, quietStart: '00:00', quietEnd: '00:00' });
  await f.request('tick'); assert.equal(f.stored.timerState.elapsed, 59);
  const { state } = await f.request('start'); assert.equal(state.manualBreak, true);
  f.advance(20000); await f.request('tick');
  assert.equal(f.stored.timerState.res, 'done');
  assert.equal(f.stored.timerState.manualBreak, true);
});
test('strict mode rejects snooze and skip centrally, including popup requests', async () => {
  const f = fixture({}, { strict: true });
  const { state } = await f.request('start');
  await f.request('skip', { sessionId: String(state.breakEnd) }); await f.request('snooze');
  assert.equal(f.stored.timerState.phase, 'break');
  assert.equal(f.stored.timerState.snoozeCount, 0);
});
