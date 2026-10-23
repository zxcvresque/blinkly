'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Activation = require('../audio-activation.js');
const trusted = { type: 'pointerup', isTrusted: true };
function fixture(resume, options = {}) {
  const calls = { constructed: 0, resumed: 0 };
  class Context {
    constructor() { calls.constructed++; this.state = 'suspended'; }
    resume() { calls.resumed++; return resume ? resume(this) : (this.state = 'running', Promise.resolve()); }
  }
  return { calls, gate: Activation.create({ Context, getActivation: () => undefined, timeoutMs: 30, ...options }) };
}
test('locked get/ready/peek do not construct or resume audio', async () => {
  const { gate, calls } = fixture();
  assert.equal(gate.get(), null); assert.equal(gate.peek(), null); assert.equal(await gate.ready(), null);
  assert.deepEqual(calls, { constructed: 0, resumed: 0 });
});
test('synthetic or unrelated events cannot authorize a context', async () => {
  const { gate, calls } = fixture();
  for (const event of [undefined, { type: 'click', isTrusted: false }, { type: 'pointerdown', isTrusted: true }, { type: 'mousemove', isTrusted: true }])
    assert.equal(await gate.unlock(event), null);
  assert.deepEqual(calls, { constructed: 0, resumed: 0 });
});
test('trusted gesture constructs and resumes synchronously', async () => {
  const { gate, calls } = fixture();
  const result = gate.unlock(trusted);
  assert.deepEqual(calls, { constructed: 1, resumed: 1 });
  const context = await result;
  assert.equal(context.state, 'running'); assert.equal(gate.peek(), context); assert.equal(gate.get(), context);
  assert.equal(await gate.ready(), context); assert.equal(calls.resumed, 1);
});
test('native inactive activation rejects trusted Escape and other nonactivating keyboard events', async () => {
  const { gate, calls } = fixture(undefined, { getActivation: () => ({ hasBeenActive: false, isActive: false }) });
  for (const event of [{ type: 'keydown', key: 'Escape', isTrusted: true },
    { type: 'keydown', key: 'Control', ctrlKey: true, isTrusted: true }, trusted])
    assert.equal(await gate.unlock(event), null);
  assert.equal(gate.get(), null); assert.equal(await gate.ready(), null);
  assert.deepEqual(calls, { constructed: 0, resumed: 0 });
});
test('native browser activation authorizes a genuine gesture when its state becomes active', async () => {
  let active = false;
  const { gate, calls } = fixture(undefined, { getActivation: () => ({ hasBeenActive: active, isActive: active }) });
  assert.equal(await gate.unlock(trusted), null); active = true;
  const result = gate.unlock(trusted); assert.equal(calls.resumed, 1);
  assert.equal((await result).state, 'running');
});
test('browser activation permits lazy get, but get and ready never resume', async () => {
  const { gate, calls } = fixture(undefined, { getActivation: () => ({ hasBeenActive: true }) });
  assert.equal(await gate.ready(), null); assert.equal(calls.constructed, 0);
  const context = gate.get(); assert.equal(context.state, 'suspended');
  assert.equal(await gate.ready(), null); assert.equal(calls.resumed, 0);
  assert.equal(await gate.unlock({ type: 'click', isTrusted: false }), context);
  assert.deepEqual(calls, { constructed: 1, resumed: 1 });
});
test('concurrent unlocks and ready share one pending resume', async () => {
  let finish;
  const { gate, calls } = fixture(context => new Promise(resolve => { finish = () => { context.state = 'running'; resolve(); }; }));
  const first = gate.unlock(trusted), second = gate.unlock(trusted), ready = gate.ready();
  assert.equal(first, second); assert.equal(first, ready); assert.equal(calls.resumed, 1);
  finish(); assert.equal(await first, gate.peek()); assert.equal(await second, gate.peek());
});
test('a hanging resume settles within the configured timeout and permits retry', async () => {
  const { gate, calls } = fixture(() => new Promise(() => {}), { timeoutMs: 15 });
  assert.equal(await gate.unlock(trusted), null); assert.equal(await gate.ready(), null);
  assert.equal(calls.constructed, 1); assert.equal(calls.resumed, 1);
  gate.peek().resume = function () { this.state = 'running'; calls.resumed++; return Promise.resolve(); };
  assert.equal(await gate.unlock(trusted), gate.peek()); assert.equal(calls.resumed, 2);
});
test('resume rejection is handled and a later trusted event can recover', async () => {
  let attempts = 0;
  const { gate } = fixture(context => { if (!attempts++) return Promise.reject(new Error('blocked')); context.state = 'running'; return Promise.resolve(); });
  assert.equal(await gate.unlock(trusted), null); assert.equal(await gate.ready(), null);
  assert.equal(await gate.unlock({ type: 'keydown', isTrusted: true }), gate.peek());
});
test('constructor and synchronous resume failures resolve safely', async () => {
  const broken = Activation.create({ Context: class { constructor() { throw new Error('unavailable'); } }, getActivation: () => ({ hasBeenActive: true }) });
  assert.equal(broken.get(), null); assert.equal(await broken.unlock(trusted), null);
  const { gate } = fixture(() => { throw new Error('resume failed'); });
  assert.equal(await gate.unlock(trusted), null);
});
test('failed activation lookup stays locked', async () => {
  const { gate, calls } = fixture(undefined, { getActivation: () => { throw new Error('unavailable'); } });
  assert.equal(gate.get(), null); assert.equal(await gate.unlock({ type: 'click', isTrusted: false }), null);
  assert.equal(calls.constructed, 0);
  assert.equal(await gate.unlock(trusted), null); assert.equal(calls.constructed, 0);
});

function eventFixture(onReady, options = {}) {
  const instances = [];
  class Context extends EventTarget {
    constructor() { super(); this.state = 'suspended'; instances.push(this); }
    resume() { return new Promise(() => {}); }
    transition(state) { this.state = state; this.dispatchEvent(new Event('statechange')); }
  }
  return { instances, gate: Activation.create({ Context, onReady, getActivation: () => undefined, timeoutMs: 10, ...options }) };
}

test('late native activation notifies once per running transition after resume times out', async () => {
  const notifications = [];
  const { gate, instances } = eventFixture(context => notifications.push(context));
  assert.equal(gate.get(), null); assert.equal(await gate.ready(), null);
  assert.equal(instances.length, 0); assert.deepEqual(notifications, []);
  assert.equal(await gate.unlock({ type: 'click', isTrusted: false }), null);
  assert.equal(instances.length, 0); assert.deepEqual(notifications, []);
  assert.equal(await gate.unlock(trusted), null, 'hanging hardware resume must time out');
  const context = instances[0];
  assert.deepEqual(notifications, []);
  context.transition('suspended'); assert.deepEqual(notifications, []);
  context.transition('running'); assert.deepEqual(notifications, [context]);
  assert.equal(await gate.ready(), context);
  context.transition('running'); assert.equal(notifications.length, 1, 'duplicate running events are not new transitions');
  context.transition('suspended'); assert.equal(notifications.length, 1);
  context.transition('running'); assert.deepEqual(notifications, [context, context]);
});

test('onReady callback failures are contained for synchronous throws and rejected promises', async () => {
  for (const onReady of [() => { throw new Error('consumer failed'); }, () => Promise.reject(new Error('async consumer failed'))]) {
    const { gate, instances } = eventFixture(onReady);
    await gate.unlock(trusted);
    assert.doesNotThrow(() => instances[0].transition('running'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(await gate.ready(), instances[0]);
  }
});

test('callbacks from a replaced closed context cannot announce readiness for the new context', async () => {
  const notifications = [];
  const { gate, instances } = eventFixture(context => notifications.push(context));
  await gate.unlock(trusted);
  const previous = instances[0]; previous.transition('closed');
  await gate.unlock(trusted);
  const current = instances[1]; assert.ok(current);
  previous.transition('running'); assert.deepEqual(notifications, []);
  current.transition('running'); assert.deepEqual(notifications, [current]);
});

test('onReady is optional and does not fire for an already-running constructor without a transition', async () => {
  const notifications = [];
  class Context extends EventTarget {
    constructor() { super(); this.state = 'running'; }
  }
  const gate = Activation.create({ Context, onReady: context => notifications.push(context), getActivation: () => ({ hasBeenActive: true }) });
  const context = await gate.unlock(trusted);
  assert.equal(context.state, 'running'); assert.deepEqual(notifications, []);
  context.dispatchEvent(new Event('statechange')); assert.deepEqual(notifications, []);
  const optional = eventFixture(undefined);
  await optional.gate.unlock(trusted);
  assert.doesNotThrow(() => optional.instances[0].transition('running'));
});
