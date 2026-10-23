const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cadence = require('../voice-cadence.js');

test('short rests allow only an opening line, with no step-by-step narration', () => {
  for (const duration of [10, 15, 20, 25, 30, 35, 39.999]) {
    assert.equal(cadence.maxUtterances(duration), 1);
    assert.deepEqual([0, 1, 2, 3].filter(step => cadence.restStepAllowed(duration, step)), [0]);
  }
});

test('longer rests allow only the opening and one later prompt', () => {
  for (const duration of [40, 45, 60, 90, 120]) {
    assert.equal(cadence.maxUtterances(duration), 2);
    assert.deepEqual([0, 1, 2, 3].filter(step => cadence.restStepAllowed(duration, step)), [0, 2]);
  }
  for (const step of [-1, 4, NaN, undefined, '0']) assert.equal(cadence.restStepAllowed(120, step), false);
});

test('missing or invalid duration keeps the calm twenty-second default', () => {
  for (const duration of [undefined, null, NaN, Infinity, -1, 0, '120']) {
    assert.equal(cadence.maxUtterances(duration), 1);
    assert.equal(cadence.restStepAllowed(duration, 0), true);
    assert.equal(cadence.restStepAllowed(duration, 2), false);
  }
});

test('browser global and CommonJS expose the same cadence without other dependencies', () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../voice-cadence.js'), 'utf8'), context);
  for (const duration of [20, 40, 120]) for (const step of [0, 1, 2, 3])
    assert.equal(context.BlinklyVoiceCadence.restStepAllowed(duration, step), cadence.restStepAllowed(duration, step));
});
