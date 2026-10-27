'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../landing-scroll-preview.js');

function harness() {
  const images = [], draws = [];
  class Image {
    constructor() { images.push(this); }
    removeAttribute() { this.aborted = true; }
    complete() { this.onload?.(); }
    fail() { this.onerror?.(); }
  }
  const context = { globalAlpha: 1, drawImage(image) { draws.push({ source: image.src, alpha: this.globalAlpha }); } };
  const canvas = { dataset: {}, style: {}, getContext: () => context };
  const manifest = { width: 1440, height: 900, duration: 20,
    frames: Array.from({ length: 41 }, (_, index) => ({ time: index / 2, src: 'frame-' + index })) };
  const controller = create({ canvas, manifest, Image });
  return { controller, images, draws, canvas, complete(index) { images.find(image => image.src === 'frame-' + index).complete(); } };
}

test('loading is deferred and bounded, with latest requested frames taking priority', () => {
  const h = harness();
  assert.equal(h.images.length, 0);
  h.controller.setProgress(0);
  assert.equal(h.images.length, 4);
  h.controller.setProgress(1);
  h.complete(0);
  assert.equal(h.images.at(-1).src, 'frame-40');
  assert.equal(h.controller.getState().pendingFrames, 4);
  assert.equal(h.canvas.style.opacity, '1', 'A decoded fallback fills the canvas while the target loads');
  assert.equal(h.canvas.dataset.drawnFrame, '0');
  assert.equal(h.canvas.dataset.ready, 'false');
  h.complete(40);
  assert.equal(h.canvas.dataset.drawnFrame, '40');
  assert.equal(h.canvas.dataset.ready, 'true');
});

test('half-second captures blend continuously and reverse to the same captured frame', () => {
  const h = harness(); h.controller.setProgress(0);
  h.complete(0); h.complete(1);
  h.controller.setProgress(.25 / 20);
  assert.deepEqual(h.draws.slice(-2), [{ source: 'frame-0', alpha: 1 }, { source: 'frame-1', alpha: .5 }]);
  assert.equal(h.canvas.dataset.ready, 'true');
  h.controller.setProgress(.5 / 20);
  assert.deepEqual(h.draws.at(-1), { source: 'frame-1', alpha: 1 });
  h.controller.setProgress(0);
  assert.deepEqual(h.draws.at(-1), { source: 'frame-0', alpha: 1 });
});

test('failed requests preserve a decoded frame and destroy prevents pending work from drawing', () => {
  const h = harness(); h.controller.setProgress(0); h.complete(0);
  h.controller.setProgress(1);
  h.images.find(image => image.src === 'frame-1').fail();
  assert.equal(h.canvas.dataset.drawnFrame, '0');
  assert.equal(h.canvas.dataset.failedFrames, '1');
  const pendingImage = h.images.find(image => image.src === 'frame-40');
  const pendingCallback = pendingImage.onload, drawCount = h.draws.length;
  h.controller.destroy();
  pendingCallback(); h.controller.setProgress(.5);
  assert.equal(h.draws.length, drawCount);
  assert.equal(pendingImage.aborted, true);
  assert.equal(h.canvas.dataset.destroyed, 'true');
});
