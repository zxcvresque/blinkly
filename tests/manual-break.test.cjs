'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../blinkly.user.js'), 'utf8');
const action = source.slice(source.indexOf('  function startBreak('), source.indexOf('  function endBreak('));
function fixture(phase = 'work') {
  const calls = [], panel = { open: true }, S = { phase, breakEnd: 123 };
  const ctx = { S, Store: { coordinated: false }, cfg: { breakSec: 20, notify: false }, Date: { now: () => 1000 },
    togglePanel: open => { panel.open = open; calls.push('panel'); },
    enableAudio: event => calls.push(event), stopVoice: () => calls.push('stop'),
    sharedCommand: async (action, details) => { calls.push({ action, ...details }); return { ok: true }; },
    save: () => calls.push('save'), chime: () => calls.push('chime'), hideToast: () => calls.push('toast'),
    render: () => { assert.equal(panel.open, false, 'settings are hidden before the rest is revealed'); calls.push('render'); } };
  vm.createContext(ctx); vm.runInContext(action, ctx);
  return { ...ctx, panel, calls };
}
test('manual settings action closes the panel and uses its genuine click to unlock audio', () => {
  const f = fixture(), click = { isTrusted: true, type: 'click' };
  f.startBreak('manual', click);
  assert.equal(f.panel.open, false); assert.equal(f.S.phase, 'break'); assert.equal(f.S.manualBreak, true);
  assert.equal(f.S.breakEnd, 21000); assert.ok(f.calls.includes(click)); assert.ok(f.calls.includes('render'));
});
test('Take a break now reveals an already-running break without resetting its deadline', () => {
  const f = fixture('break'); f.startBreak('manual', { isTrusted: true, type: 'click' });
  assert.equal(f.panel.open, false); assert.equal(f.S.breakEnd, 123); assert.ok(!f.calls.includes('stop'));
});
test('automatic breaks close settings without inventing user activation', () => {
  const f = fixture(); f.startBreak('automatic');
  assert.equal(f.panel.open, false); assert.equal(f.S.manualBreak, false);
  assert.equal(f.calls.filter(value => typeof value === 'object').length, 0);
});
test('extension settings action closes immediately and delegates one shared break', async () => {
  const f = fixture();
  f.Store.coordinated = true;
  const click = { isTrusted: true, type: 'click' };
  await f.startBreak('manual', click);
  assert.equal(f.panel.open, false); assert.ok(f.calls.includes(click));
  assert.equal(f.S.phase, 'work', 'the content script never starts its own competing timer');
  assert.deepEqual(f.calls.filter(value => value?.action), [{ action: 'start', manual: true }]);
  assert.ok(!f.calls.includes('save'));
});
