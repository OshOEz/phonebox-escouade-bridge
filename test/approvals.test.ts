import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalRelay, answerArgs, type Deps } from '../src/approvals.ts';
import type { PermissionRequest } from '../src/phonebox.ts';

const req = (request: string, type: PermissionRequest['type'] = 'permission'): PermissionRequest => ({
  request, type, tool: 'Bash', arg: 'ls', description: null,
  agent: { id: 'ag1', name: 'a', project: 'demo-api', projectId: 'p1', ticket: null },
});

// A fake phone whose answers the test gives by hand.
function fake() {
  const asks: { body: any; signal: AbortSignal; resolve: (d: 'allow' | 'deny' | null) => void }[] = [];
  const answers: [string, string][] = [];
  const logs: string[] = [];
  let answerFails = false;
  const deps: Deps = {
    ask: (body, signal) => new Promise((resolve) => asks.push({ body, signal, resolve })),
    answer: async (r, d) => { if (answerFails) throw new Error('déjà répondue'); answers.push([r.request, d]); },
    cwdOf: (id) => `/projects/${id}`,
    log: (l) => logs.push(l),
  };
  return { deps, asks, answers, logs, failAnswers: () => (answerFails = true) };
}
const tick = () => new Promise((r) => setImmediate(r));

test('forwards a new permission once', () => {
  const f = fake();
  const relay = new ApprovalRelay(f.deps);
  relay.sync([req('r1')]);
  relay.sync([req('r1')]);
  assert.equal(f.asks.length, 1);
  assert.equal(f.asks[0].body.cwd, '/projects/p1');
  assert.deepEqual(relay.inFlight(), ['r1']);
});

test('ignores questions', () => {
  const f = fake();
  new ApprovalRelay(f.deps).sync([req('q1', 'question')]);
  assert.equal(f.asks.length, 0);
});

test('answers allow', async () => {
  const f = fake();
  const relay = new ApprovalRelay(f.deps);
  relay.sync([req('r1')]);
  f.asks[0].resolve('allow');
  await tick();
  assert.deepEqual(f.answers, [['r1', 'allow']]);
  assert.deepEqual(relay.inFlight(), []);
});

test('answerArgs names the agent, as answer_permission requires', () => {
  assert.deepEqual(answerArgs(req('r1'), 'deny'), { agent: 'ag1', project: 'p1', request: 'r1', decision: 'deny' });
});

test('emptyBodyLeavesItAndNeverResends', async () => {
  const f = fake();
  const relay = new ApprovalRelay(f.deps);
  relay.sync([req('r1')]);
  f.asks[0].resolve(null);
  await tick();
  relay.sync([req('r1')]);
  assert.equal(f.asks.length, 1);
  assert.deepEqual(f.answers, []);
});

test('abortsVanished', async () => {
  const f = fake();
  const relay = new ApprovalRelay(f.deps);
  relay.sync([req('r1')]);
  relay.sync([]);
  assert.equal(f.asks[0].signal.aborted, true);
  assert.deepEqual(relay.inFlight(), []);
  f.asks[0].resolve('allow'); // A late answer after the abort is dropped.
  await tick();
  assert.deepEqual(f.answers, []);
});

test('forgets requests no longer listed', () => {
  const f = fake();
  const relay = new ApprovalRelay(f.deps);
  relay.sync([req('r1')]);
  relay.sync([]);
  relay.sync([req('r1')]); // Same id coming back is a new request for Escouade: never happens, but no leak either way.
  assert.equal(f.asks.length, 2);
});

test('swallows answer errors', async () => {
  const f = fake();
  f.failAnswers();
  const relay = new ApprovalRelay(f.deps);
  relay.sync([req('r1')]);
  f.asks[0].resolve('deny');
  await tick();
  await tick();
  assert.equal(f.logs.length, 1);
  assert.match(f.logs[0], /déjà répondue/);
});

test('logs a phone that cannot be reached', async () => {
  const f = fake();
  const deps: Deps = { ...f.deps, ask: () => Promise.reject(new Error('ECONNREFUSED')) };
  new ApprovalRelay(deps).sync([req('r1')]);
  await tick();
  await tick();
  assert.equal(f.logs.length, 1);
});
