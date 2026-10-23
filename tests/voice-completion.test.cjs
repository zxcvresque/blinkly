const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Voice = require('../voice-lines.js');
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../audio/catalog.json'), 'utf8'));
const pack = JSON.parse(fs.readFileSync(path.join(__dirname, '../audio/manifest.json'), 'utf8'));
const byText = new Map(catalog.clips.map(clip => [clip.text, clip]));
const periods = ['day', 'night', 'drunk'];

test('completion pools use saved audio for every supported interval and rest length', () => {
  for (let workMin = 1; workMin <= 60; workMin++) {
    for (let breakSec = 10; breakSec <= 120; breakSec += 5) {
      for (const periodOverride of periods) {
        const pool = Voice.completionPool({ workMin, breakSec, periodOverride });
        assert.ok(pool.length > 0, `${workMin}/${breakSec}/${periodOverride}`);
        assert.equal(new Set(pool).size, pool.length);
        for (const text of pool) {
          const clip = byText.get(text);
          assert.ok(clip, `missing saved completion: ${text}`);
          assert.equal(clip.category, 'Completion'); assert.equal(clip.usage, 'automatic');
          assert.ok(pack.clips[clip.key]); assert.equal(pack.clips[clip.key].text, text);
          assert.doesNotMatch(text, /\bIndia\b/i);
          if (workMin !== 20) assert.doesNotMatch(text, /\b20 minutes\b/, `${workMin}: ${text}`);
          if (breakSec !== 20) assert.doesNotMatch(text, /\b(?:twenty|20) seconds\b/i, `${breakSec}: ${text}`);
        }
      }
    }
  }
});

test('completion wording respects daytime, sleepy and drunken delivery without creating interval recordings', () => {
  for (const workMin of [1, 20, 60]) {
    assert.deepEqual(Voice.completionPool({ workMin, periodOverride: 'drunk' }), Voice.extra.drunkDone);
    assert.deepEqual(Voice.completionPool({ workMin, periodOverride: 'night' }), [
      ...(workMin === 20 ? [Voice.original(20).doneNight] : []), ...Voice.extra.nightDone
    ]);
    const expected = [...(workMin === 20 ? Voice.original(20).done : []), ...Voice.extra.done];
    assert.deepEqual(Voice.completionPool({ workMin, breakSec: 20, periodOverride: 'day' }), expected);
    for (const breakSec of [10, 30, 120]) assert.deepEqual(
      Voice.completionPool({ workMin, breakSec, periodOverride: 'day' }),
      expected.filter(text => !text.includes('twenty seconds')));
  }
  const date = new Date('2026-10-22T20:30:00.000Z');
  assert.deepEqual(Voice.completionPool({ date, periodOverride: 'invalid' }), Voice.extra.drunkDone);
});

test('snooze and completion metadata agree in catalog and fully assembled offline manifest', () => {
  const completion = new Set(periods.flatMap(periodOverride => Voice.completionPool({ periodOverride })));
  const snooze = new Set(periods.flatMap(periodOverride => [0, 1, 2]
    .flatMap(snoozeCount => Voice.pool('snooze', { periodOverride, snoozeCount }))));
  assert.equal(completion.size, 13); assert.equal(snooze.size, 6);
  for (const [category, texts] of [['Completion', completion], ['Snooze', snooze]]) {
    for (const text of texts) {
      const clip = byText.get(text), saved = pack.clips[clip.key];
      assert.equal(clip.category, category); assert.equal(clip.usage, 'automatic');
      assert.equal(saved.category, category); assert.equal(saved.usage, 'automatic');
      assert.equal(saved.text, clip.text); assert.equal(saved.file, clip.file);
      assert.ok(saved.bytes > 0); assert.match(saved.sha256, /^[a-f0-9]{64}$/);
    }
  }
  for (const text of [...Voice.extra.skip, ...Voice.extra.pause, ...Voice.extra.resume,
    ...Voice.extra.restart, ...Voice.extra.welcome, ...Voice.extra.media]) {
    assert.equal(byText.get(text).usage, 'manual-preview');
  }
  assert.equal(catalog.clips.length, 230); assert.equal(pack.count, 230); assert.equal(pack.complete, true);
});
