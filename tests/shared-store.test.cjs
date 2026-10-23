'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../blinkly.user.js'), 'utf8');
const snippet = source.slice(source.indexOf('  const hasGM ='), source.indexOf('  await Store.init();') + '  await Store.init();'.length);
test('a tab subscribes before loading state and never overwrites an in-flight newer storage event', async () => {
  let listener, resolveRead;
  const ctx = { chrome: { storage: {
    local: { get: () => new Promise(resolve => { resolveRead = resolve; }), set: async () => {} },
    onChanged: { addListener: fn => { listener = fn; } }
  } } };
  const initializing = vm.runInNewContext(`(async () => { ${snippet}; return Store; })()`, ctx);
  assert.equal(typeof listener, 'function', 'subscription is already installed while get is pending');
  listener({ state: { newValue: { elapsed: 500 } } }, 'local');
  resolveRead({ state: { elapsed: 100 }, cfg: { workMin: 20 } });
  const store = await initializing;
  assert.equal(store.get('state').elapsed, 500);
  assert.equal(store.get('cfg').workMin, 20);
  const value = store.get('state'); value.elapsed = 0;
  assert.equal(store.get('state').elapsed, 500, 'local rendering never mutates the cached shared snapshot');
});
test('initial worker snapshot cannot replace a newer state event received during its request', async () => {
  let listener;
  const ctx = { chrome: {
    runtime: { id: 'test-extension', sendMessage: async message => {
      assert.equal(message.action, 'snapshot');
      listener({ state: { newValue: { timerSchema: 1, revision: 3, elapsed: 503 } } }, 'local');
      return { ok: true, state: { timerSchema: 1, revision: 2, elapsed: 502 } };
    } },
    storage: { local: { get: async () => ({ state: { revision: 1, elapsed: 501 } }), set: async () => {} },
      onChanged: { addListener: fn => { listener = fn; } } }
  } };
  const store = await vm.runInNewContext(`(async () => { ${snippet}; return Store; })()`, ctx);
  assert.equal(store.coordinated, true); assert.equal(store.get('state').elapsed, 503);
});
