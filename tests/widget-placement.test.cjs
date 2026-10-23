const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Placement = require('../widget-placement.js');
const almost = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('normalization preserves unrelated settings and accepts only bounded numeric positions', () => {
  const input = { accent: '#ef5b78', corner: 'custom', widgetPosition: { x: .25, y: .75 }, warmNow: true };
  const result = Placement.normalize(input);
  assert.deepEqual(result, input);
  assert.notEqual(result, input);
  assert.notEqual(result.widgetPosition, input.widgetPosition);
  for (const position of [null, false, [], {}, { x: 0 }, { x: '0', y: 1 }, { x: -0.1, y: .5 },
    { x: 1.1, y: .5 }, { x: .5, y: NaN }, { x: Infinity, y: 0 }])
    assert.equal(Placement.normalize({ widgetPosition: position }).widgetPosition, null);
  for (const point of [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }])
    assert.deepEqual(Placement.normalize({ widgetPosition: point }).widgetPosition, point);
  for (const input of [undefined, null, false, [], 'bad']) assert.deepEqual(Placement.normalize(input), Placement.defaults);
  assert.equal(Placement.normalize({ warmNow: 'true' }).warmNow, false);
  assert.equal(Placement.normalize({ warmNow: true }).warmNow, true);
  assert.equal(Placement.normalize, Placement.normalise);
});

test('coordinates map viewport-relative travel with margins and responsive resizing', () => {
  assert.deepEqual(Placement.coordinates({ x: 0, y: 0 }, 50, 40, 1000, 800), { x: 8, y: 8 });
  assert.deepEqual(Placement.coordinates({ x: 1, y: 1 }, 50, 40, 1000, 800), { x: 942, y: 752 });
  assert.deepEqual(Placement.coordinates({ x: .5, y: .5 }, 50, 40, 1000, 800), { x: 475, y: 380 });
  const position = { x: .25, y: .75 };
  const large = Placement.coordinates(position, 50, 40, 1000, 800);
  const small = Placement.coordinates(position, 50, 40, 400, 300);
  almost(large.x, 8 + .25 * 934); almost(large.y, 8 + .75 * 744);
  almost(small.x, 8 + .25 * 334); almost(small.y, 8 + .75 * 244);
  assert.deepEqual(Placement.coordinates(null, 50, 40, 1000, 800), { x: 942, y: 752 });
  assert.deepEqual(Placement.coordinates({ x: 1, y: 1 }, 50, 40, 1000, 800, 16), { x: 934, y: 744 });
});

test('pointer placement retains the grab offset and clamps at every edge', () => {
  const middle = Placement.clampPointerToPosition(500, 400, 25, 20, 50, 40, 1000, 800);
  almost(middle.x, .5); almost(middle.y, .5);
  assert.deepEqual(Placement.coordinates(middle, 50, 40, 1000, 800), { x: 475, y: 380 });
  assert.deepEqual(Placement.clampPointerToPosition(-100, -200, 25, 20, 50, 40, 1000, 800), { x: 0, y: 0 });
  assert.deepEqual(Placement.clampPointerToPosition(5000, 3000, 25, 20, 50, 40, 1000, 800), { x: 1, y: 1 });
  const edge = Placement.clampPointerToPosition(10, 15, 2, 7, 50, 40, 1000, 800);
  assert.deepEqual(edge, { x: 0, y: 0 });
});

test('tiny and oversized viewports keep coordinates finite with a reachable top-left grab area', () => {
  for (const position of [{ x: 0, y: 0 }, { x: .5, y: .5 }, { x: 1, y: 1 }]) {
    assert.deepEqual(Placement.coordinates(position, 50, 40, 56, 46), { x: 3, y: 3 });
    assert.deepEqual(Placement.coordinates(position, 50, 40, 50, 40), { x: 0, y: 0 });
    assert.deepEqual(Placement.coordinates(position, 50, 40, 20, 10), { x: 0, y: 0 });
  }
  assert.deepEqual(Placement.clampPointerToPosition(100, 100, 5, 5, 50, 40, 20, 10), { x: 0, y: 0 });
  assert.deepEqual(Placement.coordinates({ x: 1, y: 1 }, 50, 40, 100, 80, 0), { x: 50, y: 40 });
  assert.deepEqual(Placement.coordinates({ x: 1, y: 1 }, 50, 40, 100, 80, -8), { x: 50, y: 40 });
  for (const result of [Placement.coordinates(null, NaN, Infinity, -1, undefined),
    Placement.clampPointerToPosition(NaN, Infinity, undefined, null, NaN, -4, undefined, Infinity)])
    for (const number of Object.values(result)) assert.ok(Number.isFinite(number) && number >= 0);
});

test('drag-to-normalized and normalized-to-pixel mapping round trip across widget sizes', () => {
  for (const [width, height, vw, vh] of [[46, 46, 1365, 900], [280, 46, 400, 300], [330, 64, 375, 667]]) {
    for (const position of [{ x: .01, y: .99 }, { x: .37, y: .63 }, { x: 1, y: 0 }]) {
      const pixels = Placement.coordinates(position, width, height, vw, vh);
      const normalized = Placement.clampPointerToPosition(pixels.x + 17, pixels.y + 12, 17, 12, width, height, vw, vh);
      almost(normalized.x, position.x); almost(normalized.y, position.y);
    }
  }
});

test('browser UMD exports match CommonJS without accessing DOM state', () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../widget-placement.js'), 'utf8'), context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.BlinklyPlacement.defaults)), Placement.defaults);
  assert.deepEqual(JSON.parse(JSON.stringify(context.BlinklyPlacement.coordinates({ x: .5, y: .5 }, 50, 40, 1000, 800))),
    Placement.coordinates({ x: .5, y: .5 }, 50, 40, 1000, 800));
});
