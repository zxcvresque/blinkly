const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
require('../sleep-schedule.js');
const Preferences = require('../reminder-preferences.js');
const utc = time => new Date(`2026-10-23T${time}:00Z`);

test('quiet hours include start, exclude end, and wrap UTC midnight', () => {
  const cfg = { quietEnabled: true, sleepTimezone: 'UTC' };
  for (const [time, expected] of [['22:59', false], ['23:00', true], ['00:00', true], ['06:59', true], ['07:00', false]])
    assert.equal(Preferences.quietNow(cfg, utc(time)), expected, time);
  for (const [time, expected] of [['08:59', false], ['09:00', true], ['10:59', true], ['11:00', false]])
    assert.equal(Preferences.quietNow({ ...cfg, quietStart: '09:00', quietEnd: '11:00' }, utc(time)), expected, time);
  assert.equal(Preferences.quietNow({ ...cfg, quietEnabled: false }, utc('23:00')), false);
});

test('equal quiet endpoints mean all 24 hours when enabled', () => {
  const cfg = { quietEnabled: true, quietStart: '12:00', quietEnd: '12:00', sleepTimezone: 'UTC' };
  for (const time of ['00:00', '11:59', '12:00', '23:59']) assert.equal(Preferences.quietNow(cfg, utc(time)), true);
  assert.equal(Preferences.quietNow({ ...cfg, quietEnabled: false }, utc('12:00')), false);
});

test('quiet hours follow the sleep timezone, including device timezone', () => {
  const cfg = { quietEnabled: true }, instant = utc('22:30');
  assert.equal(Preferences.quietNow({ ...cfg, sleepTimezone: 'Asia/Kolkata' }, instant), true);
  assert.equal(Preferences.quietNow({ ...cfg, sleepTimezone: 'UTC' }, instant), false);
  const hour = instant.getHours();
  assert.equal(Preferences.quietNow({ ...cfg, sleepTimezone: 'local' }, instant), hour >= 23 || hour < 7);
  const context = { Intl, Date };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../reminder-preferences.js'), 'utf8'), context);
  assert.equal(context.BlinklyPreferences.quietNow({ ...cfg, sleepTimezone: 'invalid' }, instant), true);
  assert.equal(context.BlinklyPreferences.quietNow({ ...cfg, sleepTimezone: 'UTC' }, instant), false);
});

test('muting excludes clips before favorites prefer remaining eligible options', () => {
  const lines = ['a', 'b', 'c', 'a'], key = text => `vo_${text}`;
  assert.deepEqual(Preferences.eligible(lines, {}, key), ['a', 'b', 'c']);
  assert.deepEqual(Preferences.eligible(lines, { mutedClips: ['vo_a'] }, key), ['b', 'c']);
  assert.deepEqual(Preferences.eligible(lines, { favoriteClips: ['vo_a', 'vo_c'] }, key), ['a', 'c']);
  assert.deepEqual(Preferences.eligible(lines, { favoriteClips: ['vo_a'], mutedClips: ['vo_a'] }, key), ['b', 'c']);
  assert.deepEqual(Preferences.eligible(lines, { favoriteClips: ['vo_other'] }, key), ['a', 'b', 'c']);
  assert.deepEqual(Preferences.eligible(lines, { mutedClips: ['vo_a', 'vo_b', 'vo_c'] }, key), []);
  assert.deepEqual(Preferences.eligible(null, {}, key), []);
});

test('normalization validates fields, preserves unrelated settings, and bounds clip arrays', () => {
  const cfg = Preferences.normalize({ workMin: 25, quietEnabled: 'true', quietStart: '24:00', quietEnd: '7:00',
    factsEvery: 4, favoriteClips: ['vo_a', 'vo_a', 'vo_ABC', '../bad', null, 'vo_b'], mutedClips: false });
  assert.equal(cfg.workMin, 25);
  assert.equal(cfg.quietEnabled, false);
  assert.equal(cfg.quietStart, '23:00');
  assert.equal(cfg.quietEnd, '07:00');
  assert.equal(cfg.factsEvery, 3);
  assert.deepEqual(cfg.favoriteClips, ['vo_a', 'vo_b']);
  assert.deepEqual(cfg.mutedClips, []);
  assert.equal(Preferences.normalize({ factsEvery: '5' }).factsEvery, 5);
  for (const factsEvery of [0, 1, 2, 3, 5, 10]) assert.equal(Preferences.normalize({ factsEvery }).factsEvery, factsEvery);
  for (const factsEvery of [true, false, '', null, 1.5, NaN]) assert.equal(Preferences.normalize({ factsEvery }).factsEvery, 3);
  const many = Array.from({ length: 600 }, (_, index) => `vo_${index}`);
  assert.equal(Preferences.normalize({ favoriteClips: many, mutedClips: many }).favoriteClips.length, 512);
  assert.equal(Preferences.normalize({ favoriteClips: many, mutedClips: many }).mutedClips.length, 512);
  for (const bad of [null, false, [], 'bad']) assert.deepEqual(Preferences.normalize(bad), Preferences.defaults);
  assert.equal(Preferences.normalise, Preferences.normalize);
});
