'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Samples = require('../landing-voice-samples.js');
const Voice = require('../voice-lines.js');
const catalog = new Map(require('../audio/catalog.json').clips.map(clip => [clip.key, clip]));
function harness() {
  const audios = [], timers = new Map(), states = []; let time = 0, next = 0;
  class Audio {
    constructor() { this.paused = true; audios.push(this); }
    play() { this.paused = false; this.onplaying?.(); return Promise.resolve(); }
    pause() { this.paused = true; }
    removeAttribute() { this.src = ''; }
    load() {}
  }
  const player = Samples.createPlayer({ Audio, now: () => time, onState: state => states.push(state),
    setTimeout: (fn, delay) => { timers.set(++next, { fn, delay }); return next; },
    clearTimeout: id => timers.delete(id) });
  return { player, audios, timers, states, advance: value => { time += value; },
    finish: () => audios.at(-1).onended(), runNext: () => { const [id, task] = timers.entries().next().value; timers.delete(id); time += task.delay; task.fn(); } };
}
test('landing samples resolve to existing unchanged packaged recordings with consistent pet names', () => {
  for (const [key, clip] of Object.entries(Samples.clips)) {
    assert.equal(clip.file, catalog.get(key).file);
    assert.equal(clip.transcript, catalog.get(key).transcript);
    assert.ok(fs.existsSync(path.join(__dirname, '..', clip.file)));
  }
  for (const gender of ['male', 'female']) for (const pair of Samples.plans.bal[gender]) {
    const first = catalog.get(pair[0]), second = catalog.get(pair[1]);
    const pet = Voice.petName(first.text);
    assert.ok(pet, 'personal opening speaks a pet name');
    assert.ok(!Voice.petName(second.text) || Voice.petName(second.text) === pet);
    assert.ok(first.memberships?.some(row => row.gender === gender) || gender === 'male' && first.mood === 'flirty');
  }
});
test('initialization is silent and explicit clicks rotate matching samples', () => {
  const h = harness(); assert.equal(h.audios.length, 0); assert.equal(h.timers.size, 0);
  h.player.play('bal', 'male', true); const first = h.audios[0].src;
  assert.match(first, /vo_14uffq7h2b0/);
  h.player.play('bal', 'male', true);
  assert.equal(h.audios[0].paused, true); assert.notEqual(h.audios[1].src, first);
  h.player.play('bal', 'female', true); assert.match(h.audios[2].src, /vo_1pvnc8c58ub/);
  h.player.play('bal', 'female', false); assert.match(h.audios[3].src, /vo_zzndqm7n06/);
});
test('balanced guidance waits between prompts and Stop cancels the second recording', () => {
  const h = harness(); h.player.play('bal'); h.advance(4000); h.finish();
  assert.equal(h.states.at(-1).phase, 'waiting');
  assert.equal([...h.timers.values()][0].delay, 6000);
  h.player.stop(); assert.equal(h.timers.size, 0); assert.equal(h.audios.length, 1);
  h.player.play('bal'); h.advance(4000); h.finish(); h.runNext();
  assert.equal(h.audios.length, 3); assert.equal(h.timers.size, 0);
  h.finish(); assert.equal(h.states.at(-1).phase, 'ended');
});
test('switching moments cancels queued prompts; snooze and Rested are single recordings', () => {
  const h = harness(); h.player.play('bal'); h.finish();
  h.player.play('snz'); assert.equal(h.timers.size, 0); h.finish();
  assert.equal(h.states.at(-1).phase, 'ended'); assert.equal(h.timers.size, 0);
  h.player.play('rst'); h.finish(); assert.equal(h.timers.size, 0);
});
test('a rejected old play promise cannot stop a newer sample and current failures are recoverable', async () => {
  const audios = [], states = [];
  class Audio {
    constructor() { audios.push(this); }
    play() { return new Promise((_resolve, reject) => { this.reject = reject; }); }
    pause() { this.paused = true; } removeAttribute() {} load() {}
  }
  const player = Samples.createPlayer({ Audio, onState: state => states.push(state) });
  player.play('snz'); player.play('rst'); audios[0].reject(new Error('old request canceled')); await Promise.resolve();
  assert.equal(states.at(-1).phase, 'loading');
  audios[1].reject(new Error('audio blocked')); await Promise.resolve();
  assert.equal(states.at(-1).phase, 'error'); assert.equal(audios[1].paused, true);
  player.play('snz'); assert.equal(states.at(-1).phase, 'loading'); player.stop();
});
