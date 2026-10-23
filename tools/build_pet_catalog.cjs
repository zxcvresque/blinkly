#!/usr/bin/env node
'use strict';

// Data-only build: preserves attachment copy and never calls a speech API.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
// Building the generated runtime must also work before that file exists.
globalThis.BlinklyPetClips ||= [];
const Voice = require('../voice-lines.js');
const DEFAULT_SOURCE = path.join(ROOT, 'voice-data/templates-source.txt');
const TEMPLATE_PATH = path.join(ROOT, 'voice-data/pet-templates.json');
const BLOCKS = [
  { event: 'test', start: 0, count: 8 }, { event: 'warn', start: 8, count: 8 },
  ...[0, 1, 2, 3].map(step => ({ event: 'step', step, start: 16 + step * 8, count: 8 })),
  { event: 'done', start: 48, count: 8 }, { event: 'skip', start: 56, count: 4, heading: 'Skipped' },
  { event: 'snooze', start: 60, count: 4, heading: 'Snoozed' },
  { event: 'pause', start: 64, count: 4, heading: 'Paused' },
  { event: 'welcome', start: 68, count: 4, heading: 'Welcome back' },
  { event: 'streak', start: 72, count: 4, heading: 'Good streak' },
  { event: 'fact', start: 76, count: 8 }
];
const MOODS = ['sweet', 'teasing', 'needy', 'sleepy', 'drunk'];
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function parseTemplates(source) {
  const lines = source.split(/\r?\n/), spoken = [];
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    const match = /^- (Sweet|Teasing|Needy|Sleepy|Drunk): (.+)$/.exec(line);
    if (match) spoken.push({ mood: match[1].toLowerCase(), template: match[2], sourceLine: index + 1 });
    else assert.ok(BLOCKS.some(block => block.heading === line), `Unexpected attachment line ${index + 1}`);
  });
  assert.equal(spoken.length, 168, 'Attachment must have exactly 84 templates per gender');
  const rows = [];
  for (const [genderIndex, gender] of ['male', 'female'].entries()) {
    const counters = new Map();
    for (const block of BLOCKS) {
      const selected = spoken.slice(genderIndex * 84 + block.start, genderIndex * 84 + block.start + block.count);
      const expected = block.count === 8 ? ['sweet', 'sweet', 'teasing', 'teasing', 'needy', 'sleepy', 'drunk', 'drunk']
        : block.event === 'snooze' || block.event === 'pause' ? ['sweet', 'teasing', 'sleepy', 'drunk']
          : ['sweet', 'teasing', 'needy', 'drunk'];
      assert.deepEqual(selected.map(row => row.mood), expected, `${gender}/${block.event}/${block.step ?? ''}`);
      if (block.heading) assert.equal(lines[selected[0].sourceLine - 2], block.heading);
      for (const row of selected) {
        const bucket = `${gender}-${block.event}${block.step ?? ''}-${row.mood}`;
        const ordinal = (counters.get(bucket) || 0) + 1; counters.set(bucket, ordinal);
        const id = `${bucket}-${String(ordinal).padStart(2, '0')}`;
        rows.push({ id, gender, mood: row.mood, event: block.event,
          ...(block.step !== undefined ? { step: block.step } : {}),
          template: row.template, sourceLine: row.sourceLine });
      }
    }
  }
  return { schema: 1, source: 'User-provided Pasted text.txt', sourceSha256: sha256(source),
    sourceCharacters: source.length, templateCount: rows.length,
    notes: ['The attachment has no gender headings; its two consecutive 84-row halves are male then female.',
      'The eight rows after the four Good streak rows in each half are eye facts.',
      'Templates preserve the attachment verbatim, including spellings and punctuation.'], templates: rows };
}

function loadTemplates(sourcePath = DEFAULT_SOURCE) {
  const saved = fs.existsSync(TEMPLATE_PATH) ? JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8')) : null;
  if (fs.existsSync(sourcePath)) {
    const parsed = parseTemplates(fs.readFileSync(sourcePath, 'utf8'));
    if (saved) assert.deepEqual(saved, parsed, 'Immutable template dataset differs from its source; investigate instead of overwriting it');
    else fs.writeFileSync(TEMPLATE_PATH, JSON.stringify(parsed, null, 2) + '\n');
    return parsed;
  }
  assert.ok(saved, 'Provide --source for the first build; no saved template dataset exists');
  // Reconstruct the original labeled lines to validate the saved source digest.
  // This makes later builds portable without depending on an attachment path.
  const lines = Array.from({ length: Math.max(...saved.templates.map(row => row.sourceLine)) }, () => '');
  for (const row of saved.templates) lines[row.sourceLine - 1] = `- ${row.mood[0].toUpperCase() + row.mood.slice(1)}: ${row.template}`;
  for (const genderIndex of [0, 1]) for (const block of BLOCKS) if (block.heading)
    lines[saved.templates[genderIndex * 84 + block.start].sourceLine - 2] = block.heading;
  const reconstructed = [lines.join('\n'), lines.join('\n') + '\n']
    .find(source => source.length === saved.sourceCharacters && sha256(source) === saved.sourceSha256);
  assert.ok(reconstructed, 'Saved templates do not match their immutable source digest');
  assert.deepEqual(parseTemplates(reconstructed), saved);
  return saved;
}

function render(row, pet = null) {
  const text = row.template.replaceAll('{pet}', pet ?? '').replaceAll('{mins}', '20 minutes');
  assert.ok(!/\{[^}]+\}/.test(text), `Unresolved placeholder in ${row.id}`);
  return { row, pet, text };
}

function planVariants(dataset, pools, coverAllNames) {
  const selections = new Map(), extras = [];
  for (const gender of ['male', 'female']) {
    for (const mood of MOODS) {
      const candidates = dataset.templates.filter(row => row.gender === gender && row.mood === mood && row.template.includes('{pet}'));
      const supplied = pools[gender]?.[mood];
      assert.ok(Array.isArray(supplied) && supplied.length > 0, `Missing nickname pool ${gender}/${mood}`);
      assert.equal(new Set(supplied).size, supplied.length, `Duplicate nickname in ${gender}/${mood}`);
      assert.ok(supplied.every(pet => typeof pet === 'string' && pet.trim()), 'Nicknames must be nonempty strings');
      // Stable shuffled order spreads the supplied names without favoring the first names.
      const names = [...supplied].sort((a, b) => sha256(`${gender}|${mood}|${a}`).localeCompare(sha256(`${gender}|${mood}|${b}`)));
      candidates.forEach((row, index) => selections.set(row.id, render(row, names[index % names.length])));
      if (coverAllNames) {
        for (let index = candidates.length; index < names.length; index++) {
          extras.push(render(candidates[index % candidates.length], names[index]));
        }
      }
    }
  }
  return [...dataset.templates.map(row => selections.get(row.id) || render(row)), ...extras];
}

function planBounded(dataset, pools, existing, cap = 200) {
  const variants = planVariants(dataset, pools, false)
    .filter(item => ['warn', 'step', 'fact', 'test'].includes(item.row.event));
  const existingTexts = new Set(existing.clips.map(clip => clip.text));
  const newCount = () => new Set(variants.map(item => item.text).filter(text => !existingTexts.has(text))).size;
  const allowance = cap - existing.clips.length;
  assert.ok(allowance >= 0, 'Existing offline pack already exceeds the requested cap');
  // Share an identical template/name across genders where the name belongs to
  // both supplied pools. This keeps all active template rows without recording
  // the same spoken sentence twice. No gendered wording is rewritten.
  for (let index = 0; newCount() > allowance && index < variants.length; index++) {
    const current = variants[index];
    if (current.row.gender !== 'female' || !current.pet) continue;
    const shared = variants.find(item => item.row.gender === 'male'
      && item.row.template === current.row.template
      && item.row.mood === current.row.mood && item.pet
      && pools.female[current.row.mood].includes(item.pet));
    if (shared) variants[index] = render(current.row, shared.pet);
  }
  assert.ok(newCount() <= allowance, 'Active template coverage cannot fit the requested cap without further curation');
  return variants;
}

function planAdditional(dataset, pools, baselineVariants, characterBudget, maxClips = 30) {
  assert.ok(Number.isInteger(characterBudget) && characterBudget >= 0, 'Extra character budget must be a nonnegative integer');
  const selected = [], usedTexts = new Set(baselineVariants.map(item => item.text));
  const poolUsed = new Map(), globalUsed = new Set();
  const bucketCounts = new Map(), genderCounts = new Map(), eventCounts = new Map();
  let spent = 0;
  for (const item of baselineVariants) if (item.pet) {
    const bucket = `${item.row.gender}/${item.row.mood}`;
    if (!poolUsed.has(bucket)) poolUsed.set(bucket, new Set());
    poolUsed.get(bucket).add(item.pet); globalUsed.add(item.pet.toLowerCase());
  }
  const normalizeWords = value => value.toLowerCase().replace(/[^\p{L}\p{N}’']+/gu, ' ').trim();
  const baselineWords = baselineVariants.map(item => ` ${normalizeWords(item.text)} `);
  // Fixed attachment wording already speaks names such as babeee and trouble.
  // Prefer names that have not been heard there either, beyond metadata alone.
  for (const gender of ['male', 'female']) for (const mood of MOODS) for (const pet of pools[gender][mood])
    if (baselineWords.some(text => text.includes(` ${normalizeWords(pet)} `))) globalUsed.add(pet.toLowerCase());
  const group = row => row.event === 'step' ? `step${row.step}` : row.event;
  function candidates(genders, moods, events) {
    const possibilities = [];
    for (const row of dataset.templates) {
      if (!genders.includes(row.gender) || !moods.includes(row.mood) || !events.includes(row.event) || !row.template.includes('{pet}')) continue;
      const bucket = `${row.gender}/${row.mood}`;
      for (const pet of pools[row.gender][row.mood]) {
        if (poolUsed.get(bucket)?.has(pet)) continue;
        const item = render(row, pet);
        if (usedTexts.has(item.text) || spent + item.text.length > characterBudget) continue;
        possibilities.push(item);
      }
    }
    return possibilities.sort((a, b) => {
      const score = item => [globalUsed.has(item.pet.toLowerCase()) ? 1 : 0,
        bucketCounts.get(`${item.row.gender}/${item.row.mood}`) || 0, genderCounts.get(item.row.gender) || 0,
        eventCounts.get(group(item.row)) || 0, item.text.length];
      const aa = score(a), bb = score(b);
      for (let index = 0; index < aa.length; index++) if (aa[index] !== bb[index]) return aa[index] - bb[index];
      return sha256(`${a.row.id}|${a.pet}`).localeCompare(sha256(`${b.row.id}|${b.pet}`));
    });
  }
  function add(item) {
    if (!item || selected.length >= maxClips) return false;
    const bucket = `${item.row.gender}/${item.row.mood}`;
    poolUsed.get(bucket).add(item.pet); globalUsed.add(item.pet.toLowerCase());
    bucketCounts.set(bucket, (bucketCounts.get(bucket) || 0) + 1);
    genderCounts.set(item.row.gender, (genderCounts.get(item.row.gender) || 0) + 1);
    eventCounts.set(group(item.row), (eventCounts.get(group(item.row)) || 0) + 1);
    usedTexts.add(item.text); spent += item.text.length; selected.push(item); return true;
  }
  // Only the drunk voice-test template has a nickname placeholder. Two extra
  // previews per gender cover new drunken names without rewriting fixed copy.
  for (let turn = 0; turn < 2; turn++) for (const gender of ['male', 'female'])
    add(candidates([gender], ['drunk'], ['test'])[0]);
  while (selected.length < maxClips) {
    if (!add(candidates(['male', 'female'], ['sweet', 'teasing', 'needy', 'sleepy'], ['warn', 'step', 'fact'])[0])) break;
  }
  return { variants: selected, characters: spent, budget: characterBudget };
}

const category = row => row.event === 'test' ? 'Voice test' : row.event === 'warn' ? 'Alerts'
  : row.event === 'step' ? ['Look away', 'Soften focus', 'Blink', 'Relax'][row.step]
    : row.event === 'fact' ? 'Eye facts' : row.event === 'done' ? 'Completion (preview only)' : 'Reactions (preview only)';
const capital = value => value[0].toUpperCase() + value.slice(1);

function buildCatalog(existing, variants) {
  const byText = new Map(existing.clips.map(clip => [clip.text, { ...clip,
    gender: clip.gender || (clip.mood === 'flirty' ? 'male' : 'neutral'),
    pet: clip.pet ?? null, templateIds: [...(clip.templateIds || [])], memberships: [...(clip.memberships || [])] }]));
  for (const { row, pet, text } of variants) {
    const membership = { templateId: row.id, gender: row.gender, mood: row.mood,
      event: row.event, ...(row.step !== undefined ? { step: row.step } : {}), ...(pet ? { pet } : {}) };
    let clip = byText.get(text);
    if (!clip) {
      const key = Voice.key(text);
      const label = row.event === 'step' ? ['Look away', 'Soften focus', 'Blink', 'Relax'][row.step]
        : { test: 'Voice check', warn: 'Break reminder', done: 'Rest complete', skip: 'Skipped break', snooze: 'Snooze reaction',
          pause: 'Paused timer', welcome: 'Welcome back', streak: 'Good streak', fact: 'Eye fact' }[row.event];
      clip = { key, text, file: `audio/${key}.mp3`,
        title: `${capital(row.mood)} ${label.toLowerCase()} · ${pet || capital(row.gender)} · ${row.id.split('-').at(-1)}`,
        category: category(row), context: row.mood === 'drunk' ? 'drunken' : row.mood === 'sleepy' ? 'sleepy' : 'normal',
        mood: row.mood, usage: ['warn', 'step', 'fact'].includes(row.event) ? 'automatic' : 'manual-preview',
        tags: [...new Set([...text.matchAll(/\[([^\]]+)\]/g)].map(match => match[1]))],
        transcript: text.replace(/\[[^\]]+\]\s*/g, '').replace(/\s+/g, ' ').trim(),
        gender: row.gender, pet, templateIds: [], memberships: [] };
      byText.set(text, clip);
    }
    if (!clip.templateIds.includes(row.id)) clip.templateIds.push(row.id);
    if (!clip.memberships.some(item => JSON.stringify(item) === JSON.stringify(membership))) clip.memberships.push(membership);
    const genders = new Set(clip.memberships.map(item => item.gender));
    if (genders.size > 1) clip.gender = 'both';
  }
  const clips = [...byText.values()];
  // A shared text can carry memberships for more than one recipient/template.
  const titles = new Set();
  for (const clip of clips) {
    let title = clip.title;
    if (clip.gender === 'both') title = title.replace(/ · (Male|Female) · /, ' · Shared · ');
    if (titles.has(title.toLowerCase())) title += ` · ${capital(clip.gender)}`;
    if (titles.has(title.toLowerCase())) title += ` · ${clip.templateIds[0]}`;
    assert.ok(!titles.has(title.toLowerCase()), `Title collision: ${title}`);
    clip.title = title; titles.add(title.toLowerCase());
  }
  assert.equal(new Set(clips.map(clip => clip.key)).size, clips.length, 'Audio-key collision');
  for (const clip of existing.clips) assert.ok(clips.some(item => item.key === clip.key && item.text === clip.text && item.file === clip.file));
  return { ...existing, petTemplateSchema: 1, clips };
}

function estimate(catalog, existing, variants, pools) {
  const existingKeys = new Set(existing.clips.map(clip => clip.key));
  const added = catalog.clips.filter(clip => !existingKeys.has(clip.key));
  const pending = catalog.clips.filter(clip => !fs.existsSync(path.join(ROOT, clip.file)));
  const coverage = {};
  for (const gender of ['male', 'female']) {
    coverage[gender] = {};
    for (const mood of MOODS) {
      const used = new Set(variants.filter(item => item.row.gender === gender && item.row.mood === mood && item.pet).map(item => item.pet));
      coverage[gender][mood] = { used: used.size, total: pools[gender][mood].length,
        missing: pools[gender][mood].filter(pet => !used.has(pet)) };
    }
  }
  const events = {};
  for (const gender of ['male', 'female']) {
    events[gender] = {};
    for (const item of variants.filter(item => item.row.gender === gender)) {
      const event = item.row.event === 'step' ? `step${item.row.step}` : item.row.event;
      events[gender][event] ||= { templates: new Set(), moods: {} };
      events[gender][event].templates.add(item.row.id);
      events[gender][event].moods[item.row.mood] = (events[gender][event].moods[item.row.mood] || 0) + 1;
    }
    for (const entry of Object.values(events[gender])) entry.templates = entry.templates.size;
  }
  return { templateMemberships: variants.length, templatesCovered: new Set(variants.map(item => item.row.id)).size,
    retainedClips: existing.clips.length, addedClips: added.length, totalClips: catalog.clips.length,
    newTextCharacters: added.reduce((sum, clip) => sum + clip.text.length, 0),
    pendingClips: pending.length, pendingTextCharacters: pending.reduce((sum, clip) => sum + clip.text.length, 0),
    pendingTranscriptCharacters: pending.reduce((sum, clip) => sum + clip.transcript.length, 0),
    coverage, events, unusedTemplateIds: [], unusedNicknamePoolEntries: Object.values(coverage)
      .flatMap(gender => Object.values(gender)).reduce((sum, mood) => sum + mood.missing.length, 0) };
}

function main() {
  const args = process.argv.slice(2), option = (name, fallback) => {
    const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1];
  };
  const sourcePath = option('--source', DEFAULT_SOURCE), output = option('--output', '/private/tmp/blinkly-pet-catalog.json');
  const dataset = loadTemplates(sourcePath);
  const pools = JSON.parse(fs.readFileSync(path.join(ROOT, 'voice-data/pet-name-pools.json'), 'utf8'));
  const installed = JSON.parse(fs.readFileSync(path.join(ROOT, 'audio/catalog.json'), 'utf8'));
  // After adoption the installed catalog also contains generated pet clips.
  // Rebuild from its untouched standard subset, not from Voice.allTexts(),
  // which the extension may later extend with the generated runtime data.
  const existing = { ...installed, clips: installed.clips.filter(clip => !clip.memberships?.length) };
  assert.equal(existing.clips.length, 105, 'Expected the original 105-clip base pack');
  const boundedVariants = planBounded(dataset, pools, existing, 200);
  const extraBudget = Number(option('--extra-character-budget', '0'));
  const extras = planAdditional(dataset, pools, boundedVariants, extraBudget, 30);
  const selectedVariants = [...boundedVariants, ...extras.variants];
  const selected = buildCatalog(existing, selectedVariants);
  assert.ok(selected.clips.length <= 230);
  fs.writeFileSync(output, JSON.stringify(selected, null, 2) + '\n');
  const runtime = selected.clips.filter(clip => clip.memberships.length).map(clip => ({ text: clip.text, memberships: clip.memberships }));
  const runtimePath = path.join(ROOT, 'voice-data/pet-clips.js');
  fs.writeFileSync(runtimePath, `/* Generated by tools/build_pet_catalog.cjs; no API access. */\n(function (scope) {\n  'use strict';\n  const clips = ${JSON.stringify(runtime, null, 2)};\n  scope.BlinklyPetClips = clips;\n  if (typeof module !== 'undefined' && module.exports) module.exports = clips;\n})(globalThis);\n`);
  const selectedIds = new Set(selectedVariants.map(item => item.row.id));
  const stats = estimate(selected, existing, selectedVariants, pools);
  stats.unusedTemplateIds = dataset.templates.filter(row => !selectedIds.has(row.id)).map(row => row.id);
  const report = { sourceSha256: dataset.sourceSha256, sourceCharacters: dataset.sourceCharacters,
    spokenTemplateCharacters: dataset.templates.reduce((sum, row) => sum + row.template.length, 0),
    strategy: 'Preserve the 200-clip pack, then optionally add at most 30 fresh-name recordings within an explicit character budget.',
    maximumTotalClips: extraBudget > 0 ? 230 : 200, selected: stats,
    additional: { clips: extras.variants.length, characters: extras.characters, characterBudget: extraBudget,
      activeClips: extras.variants.filter(item => item.row.event !== 'test').length,
      manualPreviewClips: extras.variants.filter(item => item.row.event === 'test').length,
      keys: extras.variants.map(item => Voice.key(item.text)),
      names: extras.variants.map(item => ({ gender: item.row.gender, mood: item.row.mood,
        event: item.row.event, ...(item.row.step !== undefined ? { step: item.row.step } : {}), pet: item.pet })) },
    minimalAll168Templates: (() => {
      const variants = planVariants(dataset, pools, false);
      const estimateAll = estimate(buildCatalog(existing, variants), existing, variants, pools);
      return Object.fromEntries(['templatesCovered', 'addedClips', 'totalClips', 'pendingClips', 'pendingTextCharacters']
        .map(key => [key, estimateAll[key]]));
    })(), output, runtimePath };
  fs.writeFileSync(output.replace(/\.json$/, '') + '-estimate.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) main();
module.exports = { parseTemplates, loadTemplates, planVariants, planBounded, planAdditional, buildCatalog, estimate };
