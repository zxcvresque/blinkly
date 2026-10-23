'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { create } = require('../landing-launch-video.js');
function fixture(mobile = false, reducedMotion = false) {
  function element(extra = {}) {
    return { events: {}, attributes: {}, addEventListener(type, fn) { this.events[type] = fn; },
      setAttribute(key, value) { this.attributes[key] = value; }, ...extra };
  }
  const error = { hidden: true }, frame = { dataset: {}, style: { setProperty(key, value) { this[key] = value; } } };
  const video = element({ dataset: { landscape: 'landscape.mp4', portrait: 'portrait.mp4', landscapePoster: 'landscape.jpg', portraitPoster: 'portrait.jpg' },
    currentTime: 0, duration: 60, paused: true, muted: true, loads: [], plays: 0,
    getAttribute(name) { return this[name]; },
    load() { this.loads.push(this.src); },
    play() { this.paused = false; this.plays++; this.events.play(); return Promise.resolve(); },
    pause() { this.paused = true; this.events.pause?.(); } });
  const media = element({ matches: mobile }), playButton = element(), soundButton = element();
  const section = { hidden: true, querySelector: () => error };
  let observer, stoppedSamples = 0;
  const controller = create({ video, frame, section, playButton, soundButton, media, reducedMotion,
    Observer: class { constructor(fn) { observer = fn; } observe() {} }, onPlay: () => stoppedSamples++ });
  const metadata = () => { video.videoWidth = media.matches ? 1080 : 1920; video.videoHeight = media.matches ? 1920 : 1080; video.events.loadedmetadata(); };
  return { video, frame, section, error, playButton, soundButton, media, controller, metadata,
    view: visible => observer([{ isIntersecting: visible }]), stoppedSamples: () => stoppedSamples };
}
test('desktop and mobile initially request only their matching launch file and poster', () => {
  for (const mobile of [false, true]) {
    const f = fixture(mobile), layout = mobile ? 'portrait' : 'landscape';
    assert.deepEqual(f.video.loads, [layout + '.mp4']);
    assert.equal(f.video.poster, layout + '.jpg'); assert.equal(f.section.hidden, false);
    assert.equal(f.frame.dataset.layout, layout); assert.equal(f.video.plays, 0);
  }
});
test('visible video autoplays muted and pauses when it leaves the screen', () => {
  const f = fixture(); f.metadata(); f.view(true);
  assert.equal(f.video.plays, 1); assert.equal(f.video.muted, true); assert.equal(f.playButton.textContent, 'Pause');
  assert.equal(f.stoppedSamples(), 1); f.view(false); assert.equal(f.video.paused, true);
});
test('switching device sizes preserves playback position, sound choice and manual pause', () => {
  const f = fixture(); f.metadata(); f.view(true); f.soundButton.events.click();
  f.playButton.events.click(); f.video.currentTime = 27.5;
  f.media.matches = true; f.media.events.change(); f.metadata();
  assert.equal(f.video.src, 'portrait.mp4'); assert.equal(f.video.currentTime, 27.5);
  assert.equal(f.video.muted, false); assert.equal(f.video.paused, true);
  assert.equal(f.frame.style['--ar'], 9 / 16);
  f.view(false); f.view(true); assert.equal(f.video.paused, true);
});
test('an active player resumes after a source switch only when visible', () => {
  const f = fixture(true); f.metadata(); f.view(true);
  f.media.matches = false; f.media.events.change(); f.metadata();
  assert.equal(f.video.paused, false); assert.equal(f.video.src, 'landscape.mp4');
  f.view(false); f.media.matches = true; f.media.events.change(); f.metadata(); assert.equal(f.video.paused, true);
});
test('reduced motion requires an explicit Play click and sample playback can stop the video', () => {
  const f = fixture(false, true); f.metadata(); f.view(true); assert.equal(f.video.plays, 0);
  f.playButton.events.click(); assert.equal(f.video.plays, 1);
  f.controller.pause(); assert.equal(f.video.paused, true);
  f.view(false); f.view(true); assert.equal(f.video.paused, true);
});
test('media errors leave the section and fallback video links available', () => {
  const f = fixture(); f.video.events.error();
  assert.equal(f.section.hidden, false); assert.equal(f.error.hidden, false);
  f.media.matches = true; f.media.events.change(); assert.equal(f.error.hidden, true);
});
