const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const voicePath = path.join(root, 'voice-lines.js');
const voice = require(voicePath);
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'audio/catalog.json'), 'utf8'));
const allTexts = new Set(voice.allTexts(20));
const clips = new Map(catalog.clips.map(clip => [clip.text, clip]));
const contexts = {
  day: new Date('2026-10-23T06:30:00.000Z'),
  night: new Date('2026-10-22T18:30:00.000Z'),
  drunk: new Date('2026-10-22T20:30:00.000Z')
};

test('original sentences retain their exact source and results for every supported work interval', () => {
  const source = fs.readFileSync(voicePath, 'utf8');
  const originalSource = fs.readFileSync(path.join(__dirname, 'original-voice-source.txt'), 'utf8');
  assert.ok(source.includes(originalSource), 'the complete original VO source must remain byte-for-byte intact');
  for (let workMin = 1; workMin <= 60; workMin++) {
    const expected = vm.runInNewContext(`${originalSource}\nVO();`, { cfg: { workMin } });
    assert.deepEqual(voice.original(workMin), JSON.parse(JSON.stringify(expected)), `workMin=${workMin}`);
  }
});

test('catalog keeps the 105 base texts and bounded personal recordings with stable requested voice metadata', () => {
  assert.equal(catalog.voiceId, 'hpp4J3VqNfWAUOO0d1Us');
  assert.equal(catalog.model, 'eleven_v4');
  assert.equal(catalog.voiceId, voice.VOICE_ID);
  assert.equal(catalog.model, voice.MODEL);
  assert.equal(catalog.format, 'mp3_44100_128');
  assert.deepEqual(catalog.workMinutes, { min: 20, max: 20 });
  const flatten = value => typeof value === 'string' ? [value] : Object.values(value).flatMap(flatten);
  const base = new Set([...flatten(voice.original(20)), ...flatten(voice.extra)]);
  assert.equal(base.size, 105, 'all 105 existing sentences remain unchanged');
  for (const text of base) assert.ok(clips.has(text), `missing existing sentence: ${text}`);
  assert.equal(allTexts.size, base.size + voice.petClips.filter(clip => !base.has(clip.text)).length);
  assert.ok(catalog.clips.length > 105 && catalog.clips.length <= 230);
  assert.equal(clips.size, allTexts.size, 'no duplicate text entries');
  assert.equal(new Set(catalog.clips.map(clip => clip.key)).size, catalog.clips.length, 'no key collisions');
  assert.equal(new Set(catalog.clips.map(clip => clip.file)).size, catalog.clips.length, 'one filename per clip');
  assert.deepEqual(new Set(clips.keys()), allTexts);
  for (const clip of catalog.clips) {
    assert.match(clip.key, /^vo_[a-z0-9]+$/);
    assert.equal(clip.key, voice.key(clip.text), clip.text);
    assert.equal(clip.file, `audio/${clip.key}.mp3`);
  }
  // Fixed examples catch unintended changes to the cache-key algorithm or its metadata input.
  assert.equal(voice.key(voice.original().test), 'vo_1xy2mhrhle3');
  assert.equal(voice.key(voice.original().warn[0]), 'vo_20llnttxp6o');
  assert.equal(voice.key(voice.original().warn[5]), 'vo_1hxqyen965g');
});

test('every library clip has a unique curated name, category, performance context and plain transcript', () => {
  const { buildCatalog } = require('../tools/annotate_audio.cjs');
  assert.deepEqual(buildCatalog(catalog), catalog, 'checked-in metadata must match the annotation tool');
  const categories = new Set([
    'Alerts', 'Look away', 'Soften focus', 'Blink', 'Relax', 'Eye facts',
    'Completion', 'Snooze', 'Reactions (preview only)', 'Voice test'
  ]);
  const titles = new Set();
  const automatic = new Set();
  for (const date of Object.values(contexts)) {
    for (const recipientGender of ['male', 'female']) {
    for (const snoozeCount of [0, 1, 2]) {
      for (const event of ['warn', 'fact', 'snooze']) {
        for (const text of voice.pool(event, { date, snoozeCount, flirty: true, recipientGender })) automatic.add(text);
      }
      for (const text of voice.completionPool({ date, workMin: 20, breakSec: 20 })) automatic.add(text);
      for (let step = 0; step < 4; step++) {
        for (const text of voice.pool('step', { date, snoozeCount, step, flirty: true, recipientGender })) automatic.add(text);
      }
    }
    }
  }
  for (const clip of catalog.clips) {
    assert.ok(typeof clip.title === 'string' && clip.title.trim().length >= 5, clip.key);
    assert.notEqual(clip.title, clip.key);
    assert.doesNotMatch(clip.title, /^vo_|\[[^\]]+\]|^clip\s*\d+$/i);
    assert.ok(!titles.has(clip.title.toLowerCase()), `duplicate title: ${clip.title}`);
    titles.add(clip.title.toLowerCase());
    assert.ok(categories.has(clip.category), `${clip.title}: ${clip.category}`);
    assert.ok(['normal', 'sleepy', 'drunken'].includes(clip.context), clip.title);
    assert.equal(clip.context === 'drunken', clip.text.includes('[drunken voice]'), clip.title);
    assert.equal(clip.usage, automatic.has(clip.text) ? 'automatic' : 'manual-preview', clip.title);
    const tags = [...new Set([...clip.text.matchAll(/\[([^\]]+)\]/g)].map(match => match[1]))];
    assert.deepEqual(clip.tags, tags, clip.title);
    assert.equal(clip.transcript, clip.text.replace(/\[[^\]]+\]\s*/g, '').replace(/\s+/g, ' ').trim(), clip.title);
    assert.ok(clip.transcript.length > 0, clip.title);
    assert.doesNotMatch(clip.transcript, /\[|\]/, clip.title);
    assert.doesNotMatch(clip.text, /\bIndia\b/i, clip.title);
  }
  assert.equal(titles.size, catalog.clips.length);
  assert.equal(catalog.clips.filter(clip => clip.mood === 'flirty').length, 12);
  assert.deepEqual(new Set(catalog.clips.map(clip => clip.category)), categories);
});

test('late-night reminders use the requested phrasing without location narration', () => {
  assert.equal(voice.extra.nightWarn[0], "[sleepy drowsy voice] [yawning] It's late, isn't it... your eyes could use a little quiet.");
  assert.equal(voice.extra.drunkWarn[0], "[drunken voice] It's late, isn't it... [chuckling] Even I can see those eyes need a break.");
});

test('flirty performances are opt-in additions to every alert and rest-step context', () => {
  const flirtyTexts = new Set([
    ...voice.extra.flirtyWarn, ...voice.extra.flirtySteps.flat(),
    ...voice.extra.drunkFlirtyWarn, ...voice.extra.drunkFlirtySteps.flat()
  ]);
  assert.equal(flirtyTexts.size, 12);
  for (const [period, date] of Object.entries(contexts)) {
    for (const snoozeCount of [0, 1, 2]) {
      for (const [event, step] of [['warn', 0], ...Array.from({ length: 4 }, (_, i) => ['step', i])]) {
        const options = { date, snoozeCount, step };
        const standard = voice.pool(event, options);
        assert.deepEqual(voice.pool(event, { ...options, flirty: false }), standard);
        assert.ok(standard.every(text => !flirtyTexts.has(text)));
        const extended = voice.pool(event, { ...options, flirty: true });
        const additional = period === 'drunk'
          ? event === 'warn' ? voice.extra.drunkFlirtyWarn : voice.extra.drunkFlirtySteps[step]
          : event === 'warn' ? voice.extra.flirtyWarn : voice.extra.flirtySteps[step];
        assert.deepEqual(extended.slice(0, standard.length + additional.length), [...standard, ...additional]);
        for (const text of additional) {
          assert.ok(clips.has(text));
          assert.equal(clips.get(text).mood, 'flirty');
          assert.equal(text.includes('[drunken voice]'), period === 'drunk');
        }
      }
      const standardFacts = voice.pool('fact', { date, snoozeCount });
      const personalFacts = voice.pool('fact', { date, snoozeCount, flirty: true });
      assert.deepEqual(personalFacts.slice(0, standardFacts.length), standardFacts);
      assert.ok(personalFacts.length > standardFacts.length);
    }
  }
});

test('valid period overrides select requested performances while invalid overrides follow IST', () => {
  for (const date of Object.values(contexts)) {
    for (const [periodOverride, referenceDate] of Object.entries(contexts)) {
      for (const flirty of [false, true]) {
        for (const [event, step] of [['warn', 0], ['fact', 0], ...Array.from({ length: 4 }, (_, i) => ['step', i])]) {
          assert.deepEqual(voice.pool(event, { date, step, flirty, periodOverride }),
            voice.pool(event, { date: referenceDate, step, flirty }));
        }
      }
    }
    for (const periodOverride of ['', 'invalid', null, 2]) {
      assert.deepEqual(voice.pool('warn', { date, periodOverride }), voice.pool('warn', { date }));
    }
  }
});

test('alert and rest-step runtime pools resolve to bundled entries for every work interval', () => {
  for (const [period, date] of Object.entries(contexts)) {
    assert.equal(voice.period(date), period);
    for (let workMin = 1; workMin <= 60; workMin++) {
      for (const snoozeCount of [0, 1, 2]) {
        const options = { date, workMin, snoozeCount };
        const cases = [['warn', options], ['fact', options]];
        for (let step = 0; step < 4; step++) cases.push(['step', { ...options, step }]);
        for (const [event, settings] of cases) {
          const pool = voice.pool(event, settings);
          const label = `${period}/${event}/step=${settings.step ?? '-'}/workMin=${workMin}/snooze=${snoozeCount}`;
          assert.ok(Array.isArray(pool) && pool.length > 0, `empty runtime pool: ${label}`);
          for (const text of pool) {
            assert.equal(typeof text, 'string', label);
            assert.ok(clips.has(text), `missing bundled sentence: ${label}: ${text}`);
            assert.equal(clips.get(text).key, voice.key(text));
          }
        }
      }
    }
  }
});

test('alerts after snoozing sound angry and after-2am IST alert/rest performances use the drunken voice', () => {
  for (const date of [contexts.day, contexts.night]) {
    assert.deepEqual(voice.pool('warn', { date, snoozeCount: 1 }), voice.extra.warnSnoozed);
    assert.ok(voice.pool('warn', { date, snoozeCount: 2 }).some(text => text.includes('[angry]')));
  }
  for (const event of ['warn', 'step', 'fact']) {
    for (const snoozeCount of [0, 1, 2]) {
      for (let step = 0; step < 4; step++) {
        assert.ok(voice.pool(event, { date: contexts.drunk, snoozeCount, step })
          .every(text => text.includes('[drunken voice]')), `${event}/${snoozeCount}/${step}`);
      }
    }
  }
});

test('each after-2am rest step has at least three distinct recorded alternatives', () => {
  for (let step = 0; step < 4; step++) {
    const pool = voice.pool('step', { date: contexts.drunk, step });
    assert.ok(new Set(pool).size >= 3, `step ${step} needs at least three distinct variants`);
    assert.equal(pool.length, new Set(pool).size, `step ${step} contains duplicate variants`);
    for (const text of pool) {
      assert.ok(text.includes('[drunken voice]'), text);
      assert.ok(clips.has(text), `missing recorded step variant: ${text}`);
    }
  }
});

test('normal and after-2am fact pools each contain three unique bundled facts', () => {
  const normal = voice.pool('fact', { date: contexts.day });
  const drunk = voice.pool('fact', { date: contexts.drunk });
  assert.deepEqual(voice.pool('fact', { date: contexts.night }), normal);
  for (const [label, pool] of [['normal', normal], ['drunk', drunk]]) {
    assert.equal(pool.length, 3, label);
    assert.equal(new Set(pool).size, 3, `${label} facts must be distinct`);
    for (const text of pool) {
      assert.ok(clips.has(text), `missing recorded ${label} fact: ${text}`);
      assert.equal(clips.get(text).key, voice.key(text));
      assert.equal(text.includes('[drunken voice]'), label === 'drunk', text);
    }
  }
  assert.equal(new Set([...normal, ...drunk]).size, 6, 'normal and drunk facts need different recordings');
});

test('IST date boundaries use midnight, 2am, 6am and 11pm independent of host timezone', () => {
  const boundaries = [
    ['2026-10-22T17:29:59.999Z', 22, 'day'],
    ['2026-10-22T17:30:00.000Z', 23, 'night'],
    ['2026-10-22T18:29:59.999Z', 23, 'night'],
    ['2026-10-22T18:30:00.000Z', 0, 'night'],
    ['2026-10-22T20:29:59.999Z', 1, 'night'],
    ['2026-10-22T20:30:00.000Z', 2, 'drunk'],
    ['2026-10-23T00:29:59.999Z', 5, 'drunk'],
    ['2026-10-23T00:30:00.000Z', 6, 'day']
  ];
  for (const [date, hour, period] of boundaries) {
    assert.equal(voice.istHour(new Date(date)), hour, date);
    assert.equal(voice.period(new Date(date)), period, date);
  }
  const script = `const v = require(${JSON.stringify(voicePath)}); process.stdout.write(JSON.stringify(${JSON.stringify(boundaries)}.map(([date]) => [date, v.istHour(new Date(date)), v.period(new Date(date))])));`;
  for (const TZ of ['UTC', 'America/Los_Angeles', 'Asia/Kolkata']) {
    const actual = JSON.parse(execFileSync(process.execPath, ['-e', script], {
      env: { ...process.env, TZ }, encoding: 'utf8'
    }));
    assert.deepEqual(actual, boundaries, `host timezone ${TZ}`);
  }
});

test('all 41 screenshot performance tags are playable during visible alert/rest sessions', () => {
  const expected = [
    'weak', 'angry', 'bored', 'menacing', 'playful', 'tired', 'excited',
    'clears throat', 'coughing', 'chuckling', 'sighing', 'sniffling', 'yawning',
    'laughing', 'sharp exhale', 'scoffing', 'humming', 'panting', 'gasping',
    'whispering', 'singing', 'slowly', 'softly', 'shouting', 'pause', 'voice breaking',
    'sleepy drowsy voice', 'witch voice', 'drunken voice',
    'keyboard typing', 'echoing', 'knocking on door', 'bell ringing', 'phone ringing',
    'dog barking', 'crowd cheering', 'applause', 'rain falling', 'drum roll',
    'heartbeat', 'engine starting'
  ];
  assert.equal(expected.length, 41);
  const activeTexts = new Set();
  for (const date of Object.values(contexts)) {
    for (const snoozeCount of [0, 1, 2]) {
      for (const text of voice.pool('warn', { date, snoozeCount })) activeTexts.add(text);
      for (let step = 0; step < 4; step++) {
        for (const text of voice.pool('step', { date, snoozeCount, step })) activeTexts.add(text);
      }
    }
  }
  const actual = new Set([...activeTexts].flatMap(text => [...text.matchAll(/\[([^\]]+)\]/g)].map(match => match[1])));
  for (const tag of expected) assert.ok(actual.has(tag), `missing [${tag}] performance`);
});
