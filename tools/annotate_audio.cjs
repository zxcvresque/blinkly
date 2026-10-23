#!/usr/bin/env node
'use strict';

// Curated library labels live beside the source groups, never inside spoken copy.
const fs = require('node:fs');
const path = require('node:path');
const voice = require('../voice-lines.js');
const catalogPath = path.resolve(__dirname, '../audio/catalog.json');

function buildCatalog(previous = {}) {
  const original = voice.original(20);
  const metadata = new Map();
  function group(lines, titles, category, usage = 'automatic', mood) {
    if (typeof lines === 'string') lines = [lines];
    if (!Array.isArray(lines) || lines.length !== titles.length)
      throw new Error(`Curated title count differs for ${category}`);
    lines.forEach((text, index) => {
      if (metadata.has(text)) throw new Error(`Duplicate curated sentence: ${text}`);
      const context = text.includes('[drunken voice]') ? 'drunken'
        : /\[(?:sleepy drowsy voice|tired)\]/.test(text) ? 'sleepy' : 'normal';
      metadata.set(text, { title: titles[index], category, context, usage, ...(mood ? { mood } : {}) });
    });
  }

  group(original.test, ['A whispered hello'], 'Voice test', 'manual-preview');
  group(original.warn, [
    'Finish your thought', 'Still typing?', 'A knock for your eyes',
    'Your break is calling', 'A teasing warning', 'The little break spell'
  ], 'Alerts');
  group(original.warnNight, ['A sleepy reminder'], 'Alerts');
  group(original.steps[0], ['Find a distant spot', 'The break-time bell', 'Far, far away'], 'Look away');
  group(original.steps[1], ['Let your eyes go soft', 'Rest like the rain', 'A little blurry is okay'], 'Soften focus');
  group(original.steps[2], ['Close all the way', 'Blinking time', 'A whispered slow blink'], 'Blink');
  group(original.steps[3], ['Shoulders down, jaw loose', 'A heartbeat and a breath', 'Let it all go'], 'Relax');
  group(original.done, [
    'Rested and ready', 'Happy eyes', 'That feels better',
    'The dog says nice job', 'Eyes recharged'
  ], 'Completion (preview only)', 'manual-preview');
  group(original.doneNight, ['Rested, or ready for sleep'], 'Completion (preview only)', 'manual-preview');

  group(voice.extra.warn, [
    'Another tab?', 'Your eyes are next', 'Emotional about a break',
    'A drum roll for screen freedom', 'A world beyond this tab', 'A tiny announcement',
    'The dog wants a break', 'Idle those eyes', 'Your eyes work so hard'
  ], 'Alerts');
  group(voice.extra.snooze, [
    'You snoozed me?', 'Keeping count', 'The rehearsed reminder'
  ], 'Reactions (preview only)', 'manual-preview');
  group(voice.extra.snoozeAgain, [
    'The snooze button is not a routine', 'Back in five minutes'
  ], 'Reactions (preview only)', 'manual-preview');
  group(voice.extra.warnSnoozed, ['Your five minutes are nearly up', 'The snooze sequel'], 'Alerts');
  group(voice.extra.steps[0], [
    'Screen down, eyes up', 'A spell for distance', 'Beyond the screen', 'Cheers for looking away'
  ], 'Look away');
  group(voice.extra.steps[1], [
    'Easy now, distant eyes', 'Nothing to solve', 'Stay with easy eyes', 'Applause for a distant gaze'
  ], 'Soften focus');
  group(voice.extra.steps[2], [
    'The blink song', 'Give your eyelids a turn', 'One blink, then another'
  ], 'Blink');
  group(voice.extra.steps[3], [
    'Whew, drop those shoulders', 'A hum for loose shoulders', 'Easy shoulders, easy breath'
  ], 'Relax');
  group(voice.extra.done, [
    'Your eyes have fans', 'A tiny standing ovation', 'Proud of twenty seconds', 'Eyes rested, shoulders free'
  ], 'Completion (preview only)', 'manual-preview');
  group(voice.extra.skip, ['Your eyes noticed the skip', 'Escaping already?'], 'Reactions (preview only)', 'manual-preview');
  group(voice.extra.pause, ['Take your time'], 'Reactions (preview only)', 'manual-preview');
  group(voice.extra.resume, ['There you are'], 'Reactions (preview only)', 'manual-preview');
  group(voice.extra.restart, ['A fresh timer'], 'Reactions (preview only)', 'manual-preview');
  group(voice.extra.welcome, ['Welcome back'], 'Reactions (preview only)', 'manual-preview');
  group(voice.extra.media, ['Waiting for your video'], 'Reactions (preview only)', 'manual-preview');
  group(voice.extra.nightWarn, ['A little late-night quiet', 'A gentle nudge'], 'Alerts');
  group(voice.extra.nightDone, ['Let the next break be bedtime'], 'Completion (preview only)', 'manual-preview');
  group(voice.extra.drunkWarn, ['A late-night reality check', 'The screen will still be here'], 'Alerts');
  group(voice.extra.drunkSnooze, ['Five minutes, I think'], 'Reactions (preview only)', 'manual-preview');
  group(voice.extra.drunkSteps[0], [
    'That distant spot, stay there', 'Hey, eyes off the screen', "That's the distant one"
  ], 'Look away');
  group(voice.extra.drunkSteps[1], [
    'Late-night easy focus', 'No squinting tonight', 'Nothing to solve out there'
  ], 'Soften focus');
  group(voice.extra.drunkSteps[2], [
    'Both eyes, please', 'Good work, eyelids', 'Close, open, nice and slow'
  ], 'Blink');
  group(voice.extra.drunkSteps[3], [
    'Breathe out, nailed it', 'Unclench that jaw', 'Let those shoulders drop'
  ], 'Relax');
  group(voice.extra.drunkDone, [
    'Responsible eyes', 'You, me, both eyes'
  ], 'Completion (preview only)', 'manual-preview');
  group(voice.extra.facts, [
    'Screens and fewer blinks', 'Blinking spreads tears', 'Full blinks keep eyes moist'
  ], 'Eye facts');
  group(voice.extra.drunkFacts, [
    'Late-night fact: screens and blinks', 'Late-night fact: spreading tears', 'Late-night fact: moist eyes'
  ], 'Eye facts');
  group(voice.extra.flirtyWarn, ['My turn in a moment', 'Twenty seconds for handsome eyes'], 'Alerts', 'automatic', 'flirty');
  group(voice.extra.flirtySteps[0], ['Daddy, look far away'], 'Look away', 'automatic', 'flirty');
  group(voice.extra.flirtySteps[1], ['Easy focus, handsome'], 'Soften focus', 'automatic', 'flirty');
  group(voice.extra.flirtySteps[2], ['A slow blink for me'], 'Blink', 'automatic', 'flirty');
  group(voice.extra.flirtySteps[3], ['Relax those shoulders, Daddy'], 'Relax', 'automatic', 'flirty');
  group(voice.extra.drunkFlirtyWarn, ['Late-night: my turn, Daddy', 'Late-night: a break for handsome'], 'Alerts', 'automatic', 'flirty');
  group(voice.extra.drunkFlirtySteps[0], ['Late-night: Daddy, eyes up'], 'Look away', 'automatic', 'flirty');
  group(voice.extra.drunkFlirtySteps[1], ['Late-night: easy, handsome'], 'Soften focus', 'automatic', 'flirty');
  group(voice.extra.drunkFlirtySteps[2], ['Late-night: one blink for me'], 'Blink', 'automatic', 'flirty');
  group(voice.extra.drunkFlirtySteps[3], ['Late-night: shoulders down, Daddy'], 'Relax', 'automatic', 'flirty');

  const texts = voice.allTexts(20).filter(text => metadata.has(text));
  if (metadata.size !== texts.length) throw new Error('Every sentence needs curated metadata');
  const titles = new Set();
  const clips = texts.map(text => {
    const details = metadata.get(text);
    if (!details) throw new Error(`Missing metadata: ${text}`);
    if (titles.has(details.title)) throw new Error(`Duplicate title: ${details.title}`);
    titles.add(details.title);
    const key = voice.key(text);
    return {
      ...(previous.clips || []).find(clip => clip.text === text),
      key, text, file: `audio/${key}.mp3`, ...details,
      tags: [...new Set([...text.matchAll(/\[([^\]]+)\]/g)].map(match => match[1]))],
      transcript: text.replace(/\[[^\]]+\]\s*/g, '').replace(/\s+/g, ' ').trim()
    };
  });
  return {
    ...previous,
    voiceId: voice.VOICE_ID,
    model: voice.MODEL,
    format: previous.format || 'mp3_44100_128',
    workMinutes: { min: 20, max: 20 },
    clips: [...clips, ...(previous.clips || []).filter(clip => clip.memberships?.length)]
  };
}

if (require.main === module) {
  const previous = fs.existsSync(catalogPath) ? JSON.parse(fs.readFileSync(catalogPath, 'utf8')) : {};
  const catalog = buildCatalog(previous);
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
  console.log(`Annotated ${catalog.clips.length} voice clips in audio/catalog.json.`);
}

module.exports = { buildCatalog };
