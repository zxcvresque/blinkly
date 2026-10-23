const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Voice = require('../voice-lines.js');
const catalog = require('../audio/catalog.json');

test('pet-name helper uses each recording nickname and matches worker classification', () => {
  for (const clip of catalog.clips) {
    const expected = typeof clip.pet === 'string' && clip.pet.trim() ? clip.pet.trim().toLowerCase()
      : clip.mood === 'flirty' || clip.memberships?.length
        ? clip.text.match(/\b(daddy|handsome|handshome|babeee|hot shtuff|trouble|mister|beautiful|vixen|gorgeoush?)\b/i)?.[0].toLowerCase() || '' : '';
    assert.equal(Voice.petName(clip.text), expected, clip.title);
  }
  for (const clip of Voice.petClips) for (const membership of clip.memberships) {
    if (membership.pet) assert.equal(Voice.petName(clip.text), membership.pet.toLowerCase());
  }
});

test('fixed spoken names are recognized and neutral guidance stays unnamed', () => {
  assert.equal(Voice.petName(Voice.extra.flirtyWarn[0]), 'daddy');
  assert.equal(Voice.petName(Voice.extra.flirtyWarn[1]), 'handsome');
  assert.equal(Voice.petName(Voice.extra.drunkFlirtySteps[1][0]), 'handsome');
  const fixed = Voice.petClips.find(clip => clip.text.includes('Shoft eyesh, babeee'));
  assert.ok(fixed); assert.equal(Voice.petName(fixed.text), 'babeee');
  for (const text of [Voice.original().test, ...Voice.original().warn, ...Voice.extra.facts,
    ...Voice.extra.done, ...Voice.extra.snooze, '', null, undefined, 1, {}]) assert.equal(Voice.petName(text), '', String(text));
});

test('named openings are available for each gender and delivery period when personal voices are on', () => {
  const saved = new Set(catalog.clips.map(clip => clip.text));
  for (const recipientGender of ['male', 'female']) for (const periodOverride of ['day', 'night', 'drunk']) {
    const pool = Voice.pool('step', { step: 0, flirty: true, recipientGender, periodOverride });
    assert.ok(pool.filter(text => saved.has(text) && Voice.petName(text)).length > 0, `${recipientGender}/${periodOverride}`);
  }
});

test('browser runtime exposes the same pet-name helper without changing the original copy', () => {
  const root = path.resolve(__dirname, '..'), context = {};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'voice-data/pet-clips.js'), 'utf8'), context);
  const source = fs.readFileSync(path.join(root, 'voice-lines.js'), 'utf8');
  assert.ok(source.includes(fs.readFileSync(path.join(__dirname, 'original-voice-source.txt'), 'utf8')));
  vm.runInContext(source, context);
  for (const clip of catalog.clips) assert.equal(context.BlinklyVoice.petName(clip.text), Voice.petName(clip.text));
});
