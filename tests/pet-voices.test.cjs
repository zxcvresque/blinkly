const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const pets = require('../voice-data/pet-clips.js');
const voice = require('../voice-lines.js');
const dataset = JSON.parse(fs.readFileSync(path.join(root, 'voice-data/pet-templates.json'), 'utf8'));
const names = JSON.parse(fs.readFileSync(path.join(root, 'voice-data/pet-name-pools.json'), 'utf8'));
const catalog = JSON.parse(fs.readFileSync(process.env.BLINKLY_PET_TEST_CATALOG || path.join(root, 'audio/catalog.json'), 'utf8'));
const byText = new Map(catalog.clips.map(clip => [clip.text, clip]));
const byId = new Map(dataset.templates.map(row => [row.id, row]));
const petTexts = new Set(pets.map(clip => clip.text));
const activeEvents = new Set(['warn', 'step', 'fact', 'test']);
const events = [['warn', 0], ...Array.from({ length: 4 }, (_, step) => ['step', step]), ['fact', 0], ['test', 0]];
const moodsFor = period => period === 'drunk' ? ['drunk'] : period === 'night' ? ['sleepy'] : ['sweet', 'teasing', 'needy'];
const matching = (clip, gender, period, event, step) => clip.memberships.some(row =>
  row.gender === gender && row.event === event && (event !== 'step' || row.step === step) && moodsFor(period).includes(row.mood));

test('all 168 source templates remain available and every active template has a bounded saved rendering', () => {
  assert.equal(dataset.templateCount, 168);
  assert.equal(dataset.templates.length, 168);
  assert.equal(byId.size, 168);
  assert.match(dataset.sourceSha256, /^[a-f0-9]{64}$/);
  for (const gender of ['male', 'female']) assert.equal(dataset.templates.filter(row => row.gender === gender).length, 84);
  assert.deepEqual(new Set(dataset.templates.map(row => row.mood)), new Set(['sweet', 'teasing', 'needy', 'sleepy', 'drunk']));
  assert.ok(pets.length >= 95 && pets.length <= 125);
  assert.ok(catalog.clips.length <= 230);
  assert.equal(petTexts.size, pets.length);
  assert.deepEqual(voice.petClips, pets);
  const represented = new Set(pets.flatMap(clip => clip.memberships.map(row => row.templateId)));
  const active = dataset.templates.filter(row => activeEvents.has(row.event));
  assert.equal(active.length, 112);
  assert.deepEqual(represented, new Set(active.map(row => row.id)));
  for (const template of dataset.templates) {
    assert.ok(typeof template.template === 'string' && template.template.length > 0);
    assert.ok(Number.isInteger(template.sourceLine) && template.sourceLine > 0);
    if (!activeEvents.has(template.event)) assert.ok(!represented.has(template.id), `unexpected new reaction recording: ${template.id}`);
  }
});

test('extra-name build preserves the initial pack and respects the explicit character and clip budgets', () => {
  const builder = require('../tools/build_pet_catalog.cjs');
  assert.deepEqual(builder.loadTemplates('/private/tmp/blinkly-source-deliberately-absent.txt'), dataset,
    'saved immutable templates support builds without the original attachment');
  const standard = { ...catalog, clips: catalog.clips.filter(clip => !clip.memberships?.length) };
  assert.equal(standard.clips.length, 105);
  const initial = builder.planBounded(dataset, names, standard, 200);
  const initialPack = builder.buildCatalog(standard, initial);
  assert.equal(initialPack.clips.length, 200);
  assert.equal(initialPack.clips.filter(clip => clip.memberships.length).length, 95);
  assert.deepEqual(builder.planAdditional(dataset, names, initial, 0).variants, []);
  const extra = builder.planAdditional(dataset, names, initial, 2300, 30);
  assert.deepEqual(builder.planAdditional(dataset, names, initial, 2300, 30), extra, 'selection must be deterministic');
  assert.equal(extra.variants.length, 30);
  assert.equal(extra.characters, extra.variants.reduce((sum, item) => sum + item.text.length, 0));
  assert.ok(extra.characters <= 2300);
  assert.equal(new Set(extra.variants.map(item => item.text)).size, 30);
  assert.equal(new Set(extra.variants.map(item => item.pet.toLowerCase())).size, 30);
  const expanded = builder.buildCatalog(standard, [...initial, ...extra.variants]);
  assert.equal(expanded.clips.length, 230);
  const newKeys = new Set(expanded.clips.filter(clip => !initialPack.clips.some(old => old.key === clip.key)).map(clip => clip.key));
  assert.equal(newKeys.size, 30);
  assert.equal(expanded.clips.filter(clip => newKeys.has(clip.key)).reduce((sum, clip) => sum + clip.text.length, 0), extra.characters);
  for (const old of initialPack.clips) {
    const saved = expanded.clips.find(clip => clip.key === old.key);
    assert.equal(saved.text, old.text); assert.equal(saved.file, old.file);
  }
  for (const gender of ['male', 'female']) {
    const selected = extra.variants.filter(item => item.row.gender === gender);
    assert.equal(selected.length, 15, 'extra recordings should balance recipients');
    assert.deepEqual(new Set(selected.map(item => item.row.mood)), new Set(['sweet', 'teasing', 'needy', 'sleepy', 'drunk']));
    assert.equal(selected.filter(item => item.row.event === 'test').length, 2);
  }
  const initialTexts = new Set(initial.map(item => item.text));
  for (const item of extra.variants) {
    assert.ok(!initialTexts.has(item.text));
    assert.ok(names[item.row.gender][item.row.mood].includes(item.pet));
    assert.ok(!initial.some(old => old.row.gender === item.row.gender && old.row.mood === item.row.mood && old.pet === item.pet));
    assert.ok(item.row.event === 'test' ? item.row.mood === 'drunk' : ['warn', 'step', 'fact'].includes(item.row.event));
  }
});

test('personal clip memberships preserve exact template words, valid nicknames, stable keys and catalog metadata', () => {
  for (const clip of pets) {
    const saved = byText.get(clip.text);
    assert.ok(saved, `missing catalog clip: ${clip.text}`);
    assert.equal(saved.key, voice.key(clip.text));
    assert.equal(saved.file, `audio/${saved.key}.mp3`);
    assert.deepEqual(saved.memberships, clip.memberships);
    assert.deepEqual(new Set(saved.templateIds), new Set(clip.memberships.map(row => row.templateId)));
    assert.doesNotMatch(clip.text, /\{(?:pet|mins)\}/);
    assert.ok(clip.memberships.length > 0);
    const genders = new Set();
    for (const membership of clip.memberships) {
      const template = byId.get(membership.templateId);
      assert.ok(template, membership.templateId);
      genders.add(membership.gender);
      for (const field of ['gender', 'mood', 'event']) assert.equal(membership[field], template[field], membership.templateId);
      assert.equal(membership.step, template.step, membership.templateId);
      if (template.template.includes('{pet}')) {
        assert.ok(names[membership.gender][membership.mood].includes(membership.pet), `invalid nickname: ${membership.templateId}/${membership.pet}`);
        assert.equal(saved.pet, membership.pet);
      } else {
        assert.equal(membership.pet, undefined);
        assert.ok(saved.pet == null || saved.pet === '');
      }
      assert.equal(clip.text, template.template.replaceAll('{pet}', membership.pet || '').replaceAll('{mins}', '20 minutes'), membership.templateId);
      assert.equal(saved.mood, membership.mood);
      assert.equal(saved.context, membership.mood === 'drunk' ? 'drunken' : membership.mood === 'sleepy' ? 'sleepy' : 'normal');
      assert.equal(saved.usage, membership.event === 'test' ? 'manual-preview' : 'automatic');
    }
    assert.equal(saved.gender, genders.size > 1 ? 'both' : [...genders][0]);
  }
});

test('personal voices are opt-in and select only matching gender, event, step and time-of-day moods', () => {
  for (const recipientGender of ['male', 'female']) for (const periodOverride of ['day', 'night', 'drunk']) {
    for (const [event, step] of events) for (const snoozeCount of [0, 1, 2]) {
      const options = { recipientGender, periodOverride, event, step, snoozeCount };
      const standard = voice.pool(event, options);
      assert.ok(standard.every(text => !petTexts.has(text)), `personal clip leaked while off: ${JSON.stringify(options)}`);
      assert.deepEqual(voice.pool(event, { ...options, flirty: false }), standard);
      const enabled = voice.pool(event, { ...options, flirty: true });
      const expected = pets.filter(clip => matching(clip, recipientGender, periodOverride, event, step)).map(clip => clip.text);
      assert.ok(expected.length > 0, `missing personal coverage: ${JSON.stringify(options)}`);
      assert.deepEqual(enabled.filter(text => petTexts.has(text)), expected, JSON.stringify(options));
      assert.equal(new Set(enabled).size, enabled.length, 'pool must deduplicate shared-gender recordings');
      for (const text of enabled) assert.ok(byText.has(text), `runtime line absent from catalog: ${text}`);
    }
  }
});

test('all requested moods are reachable for both genders in every active event and rest step', () => {
  for (const gender of ['male', 'female']) for (const [event, step] of events) {
    const reached = new Set();
    for (const periodOverride of ['day', 'night', 'drunk']) {
      const pool = new Set(voice.pool(event, { recipientGender: gender, periodOverride, flirty: true, step }));
      for (const clip of pets) if (pool.has(clip.text)) for (const row of clip.memberships)
        if (row.gender === gender && row.event === event && (event !== 'step' || row.step === step)) reached.add(row.mood);
    }
    assert.deepEqual(reached, new Set(['sweet', 'teasing', 'needy', 'sleepy', 'drunk']), `${gender}/${event}/${step}`);
  }
});

test('gendered praise never crosses pools and legacy Daddy/handsome recordings remain male-only', () => {
  const legacyMale = new Set([
    ...voice.extra.flirtyWarn, ...voice.extra.flirtySteps.flat(),
    ...voice.extra.drunkFlirtyWarn, ...voice.extra.drunkFlirtySteps.flat()
  ]);
  assert.equal(legacyMale.size, 12);
  for (const periodOverride of ['day', 'night', 'drunk']) for (const [event, step] of events) {
    const options = { periodOverride, flirty: true, step };
    const male = voice.pool(event, { ...options, recipientGender: 'male' });
    const female = voice.pool(event, { ...options, recipientGender: 'female' });
    for (const text of female) {
      assert.ok(!legacyMale.has(text), text);
      assert.doesNotMatch(text, /\b(?:good boy|Daddy|handsome)\b/i, text);
    }
    for (const text of male) assert.doesNotMatch(text, /\bgood girl\b/i, text);
    assert.deepEqual(voice.pool(event, options), male, 'recipient defaults to male');
    assert.deepEqual(voice.pool(event, { ...options, recipientGender: 'invalid' }), male);
  }
});

test('gender-aware personal facts are opt-in and belong to their daytime, sleepy or drunken pool', () => {
  for (const recipientGender of ['male', 'female']) for (const periodOverride of ['day', 'night', 'drunk']) {
    const options = { recipientGender, periodOverride };
    const original = voice.pool('fact', options), enabled = voice.pool('fact', { ...options, flirty: true });
    assert.equal(original.length, 3);
    assert.ok(enabled.length > original.length);
    assert.deepEqual(enabled.slice(0, original.length), original);
    for (const text of enabled.filter(line => petTexts.has(line))) {
      const clip = pets.find(item => item.text === text);
      assert.ok(matching(clip, recipientGender, periodOverride, 'fact', 0));
      assert.equal(text.includes('[drunken voice]'), periodOverride === 'drunk');
    }
  }
});

test('browser global and CommonJS use the same personal data before voice runtime initialization', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'voice-data/pet-clips.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'voice-lines.js'), 'utf8'), context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.BlinklyPetClips)), pets);
  assert.deepEqual(JSON.parse(JSON.stringify(context.BlinklyVoice.allTexts(20))), voice.allTexts(20));
});
