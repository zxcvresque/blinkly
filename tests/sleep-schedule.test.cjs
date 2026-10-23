const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const Sleep = require('../sleep-schedule.js');
const ist = time => new Date(`2026-10-23T${time}:00+05:30`);

test('default bedtime boundaries exactly preserve 23:00 night, 02:00 drunk, 06:00 day', () => {
  for (const [time, period, nearSleep] of [
    ['22:59', 'day', false], ['23:00', 'night', false], ['01:59', 'night', false],
    ['02:00', 'drunk', true], ['03:59', 'drunk', true], ['04:00', 'drunk', true],
    ['05:59', 'drunk', true], ['06:00', 'day', false], ['12:00', 'day', false]
  ]) {
    const result = Sleep.info({}, ist(time));
    assert.equal(result.period, period, time);
    assert.equal(result.nearSleep, nearSleep, time);
    assert.equal(Sleep.period({}, ist(time)), period);
  }
  assert.equal(Sleep.info({}, ist('04:00')).minutesUntilBed, 0);
  assert.equal(Sleep.info({}, ist('04:00')).minutesAfterBed, 0);
  const before = Sleep.info({}, ist('03:30'));
  assert.equal(before.minutesUntilBed, 30);
  assert.equal(before.minutesAfterBed, 1410);
  const after = Sleep.info({}, ist('04:30'));
  assert.equal(after.minutesUntilBed, 1410);
  assert.equal(after.minutesAfterBed, 30);
  assert.equal(before.windDownStart, '02:00');
  assert.equal(before.nightStart, '23:00');
});

test('bedtime windows wrap midnight and also support noon schedules', () => {
  for (const [bedtime, time, expected] of [
    ['23:00', '17:59', 'day'], ['23:00', '18:00', 'night'],
    ['23:00', '20:59', 'night'], ['23:00', '21:00', 'drunk'],
    ['23:00', '23:59', 'drunk'], ['23:00', '00:59', 'drunk'], ['23:00', '01:00', 'day'],
    ['12:00', '06:59', 'day'], ['12:00', '07:00', 'night'],
    ['12:00', '09:59', 'night'], ['12:00', '10:00', 'drunk'],
    ['12:00', '13:59', 'drunk'], ['12:00', '14:00', 'day'],
    ['00:00', '22:00', 'drunk'], ['00:00', '01:59', 'drunk'], ['00:00', '02:00', 'day']
  ]) assert.equal(Sleep.period({ bedtime }, ist(time)), expected, `${bedtime} at ${time}`);
});

test('sleepy styling uses night performances near bedtime and disabled scheduling uses day', () => {
  assert.equal(Sleep.period({ sleepLateStyle: 'sleepy' }, ist('04:00')), 'night');
  assert.equal(Sleep.info({ sleepLateStyle: 'sleepy' }, ist('04:00')).nearSleep, true);
  const off = Sleep.info({ sleepEnabled: false }, ist('04:00'));
  assert.equal(off.enabled, false);
  assert.equal(off.nearSleep, false);
  assert.equal(off.period, 'day');
});

test('voices-only and frequent modes change intervals only inside the bedtime window', () => {
  const cfg = { workMin: 20, sleepWorkMin: 10 };
  for (const time of ['23:00', '01:59', '02:00', '04:00', '05:59', '06:00'])
    assert.equal(Sleep.effectiveWorkMin(cfg, ist(time)), 20);
  const frequent = { ...cfg, sleepMode: 'frequent' };
  assert.equal(Sleep.effectiveWorkMin(frequent, ist('01:59')), 20);
  assert.equal(Sleep.effectiveWorkMin(frequent, ist('02:00')), 10);
  assert.equal(Sleep.effectiveWorkMin(frequent, ist('05:59')), 10);
  assert.equal(Sleep.effectiveWorkMin(frequent, ist('06:00')), 20);
  assert.equal(Sleep.effectiveWorkMin({ ...frequent, sleepEnabled: false }, ist('04:00')), 20);
  assert.equal(Sleep.effectiveWorkMin({ ...frequent, workMin: 5 }, ist('04:00')), 5);
  assert.equal(Sleep.effectiveWorkMin({ ...frequent, workMin: 60, sleepWorkMin: 1 }, ist('04:00')), 1);
});

test('selected timezone is independent of host timezone and follows daylight saving', () => {
  const instant = new Date('2026-10-22T22:30:00Z');
  assert.equal(Sleep.info({ sleepTimezone: 'Asia/Kolkata' }, instant).nowMinutes, 240);
  assert.equal(Sleep.info({ sleepTimezone: 'UTC' }, instant).nowMinutes, 1350);
  assert.equal(Sleep.period({ sleepTimezone: 'UTC' }, instant), 'day');
  const ny = { sleepTimezone: 'America/New_York' };
  assert.equal(Sleep.info(ny, new Date('2026-07-01T08:00:00Z')).nowMinutes, 240);
  assert.equal(Sleep.info(ny, new Date('2026-01-01T08:00:00Z')).nowMinutes, 180);
  const local = Sleep.info({ sleepTimezone: 'local' }, instant);
  assert.equal(local.zone, Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.equal(local.nowMinutes, instant.getHours() * 60 + instant.getMinutes());
});

test('normalization falls back on bad inputs, accepts boundaries, and leaves source untouched', () => {
  const bad = {
    sleepEnabled: 'false', bedtime: '24:00', sleepLeadMin: 301, sleepMode: 'pause',
    sleepWorkMin: 0, sleepLateStyle: 'angry', sleepTimezone: 'Mars/Olympus'
  };
  assert.deepEqual(Sleep.normalize(bad), Sleep.defaults);
  assert.equal(bad.bedtime, '24:00');
  for (const input of [null, undefined, false, [], 'bad']) assert.deepEqual(Sleep.normalize(input), Sleep.defaults);
  for (const bedtime of ['4:00', '04:60', '04:0', '04:00:00', ' 04:00', 'noon'])
    assert.equal(Sleep.normalize({ bedtime }).bedtime, '04:00');
  for (const sleepLeadMin of [30, 300]) assert.equal(Sleep.normalize({ sleepLeadMin }).sleepLeadMin, sleepLeadMin);
  for (const sleepWorkMin of [1, 60]) assert.equal(Sleep.normalize({ sleepWorkMin }).sleepWorkMin, sleepWorkMin);
  assert.equal(Sleep.normalize({ sleepLeadMin: '90', sleepWorkMin: '5' }).sleepLeadMin, 90);
  assert.equal(Sleep.normalize({ sleepLeadMin: NaN }).sleepLeadMin, 120);
  assert.equal(Sleep.normalize({ sleepWorkMin: true }).sleepWorkMin, 10);
  assert.equal(Sleep.normalize({ bedtime: '00:00' }).bedtime, '00:00');
  assert.equal(Sleep.normalize({ bedtime: '23:59' }).bedtime, '23:59');
  assert.equal(Sleep.effectiveWorkMin({ workMin: -5 }, ist('04:00')), 20);
  assert.equal(Sleep.normalize, Sleep.normalise);
});

test('UMD exports to an isolated browser global without CommonJS', () => {
  const context = { Intl, Date };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../sleep-schedule.js'), 'utf8'), context);
  assert.equal(context.BlinklySleep.period({}, ist('04:00')), 'drunk');
  assert.equal(context.BlinklySleep.defaults.bedtime, '04:00');
});
