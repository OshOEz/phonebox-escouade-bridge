import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, offlineSnapshot, euros, type Agent } from '../src/snapshot.ts';
import { agents, work, summaries, usage, now } from './fixtures/escouade.ts';

const snap = () => {
  const s = buildSnapshot({ agents, work, summaries, usage, now });
  assert.equal(s.offline, false);
  return s as Extract<typeof s, { offline: false }>;
};

test('orders waiting first', () => {
  assert.deepEqual(snap().agents.map((a) => a.name), ['tests-e2e', 'refacto-auth', 'pagination-users', 'dem-5-export-csv', 'dem-6-limiter']);
});

test('labels and colors', () => {
  const a = snap().agents[0];
  assert.equal(a.status, 'waiting');
  assert.equal(a.label, 'Attend ta réponse');
  assert.equal(a.color, '#f59e0b');
  assert.equal(a.line, 'Attend ta réponse');
  const done = snap().agents.at(-1)!;
  assert.equal(done.label, 'Fini');
  assert.equal(done.color, '#5b6472');
});

test('line is the first paragraph of the last message', () => {
  const a = snap().agents.find((x) => x.name === 'refacto-auth')!;
  assert.equal(a.line, 'Le jeton est signé en ES256.');
  assert.equal(a.last, 'Le jeton est signé en ES256.\n\nIl reste la rotation des clés.');
  assert.equal(snap().agents.find((x) => x.name === 'dem-6-limiter')!.line, '');
});

test('keeps only running subagents', () => {
  const a = snap().agents.find((x) => x.name === 'refacto-auth')!;
  assert.equal(a.subs.length, 1);
  assert.deepEqual(a.subs[0], { id: 's1', desc: 'Third rebase of the stack', status: 'running', doing: 'git rebase --onto main' });
  assert.equal(a.subsRunning, 1);
  assert.equal(a.subsDone, 18);
  assert.equal(a.bg, 4);
});

test('totals', () => {
  const t = snap().totals;
  assert.deepEqual({ active: t.active, waiting: t.waiting, done: t.done }, { active: 3, waiting: 1, done: 1 });
  assert.equal(t.cost, '4,38 $');
});

test('costs sorted with share', () => {
  const c = snap().costs;
  assert.equal(c[0].name, 'refacto-auth');
  assert.equal(c[0].share, 1);
  assert.equal(c[0].cost, '2,41 $');
  assert.ok(c.every((x, i) => i === 0 || x.share <= c[i - 1].share));
});

test('quota windows of the current account', () => {
  const q = snap().quotas;
  assert.deepEqual(q.map((x) => x.win), ['5 h', '7 j']);
  assert.deepEqual(q.map((x) => x.pct), [22, 36]);
  assert.equal(q[0].reset, 'repart à 15:10');
  assert.match(q[1].reset, /^repart [a-zé]+$/);
});

test('quota as Escouade really sends it: epoch ms and a per-model meter', () => {
  const real = { accounts: [{ name: 'MAX', engine: 'claude', current: true, meters: [
    { minutes: 300, pct: 5, resetsAt: new Date(2026, 10, 22, 15, 10).getTime() },
    { minutes: 10080, pct: 29, resetsAt: new Date(2026, 10, 26, 9, 0).getTime(), model: 'Fable' },
  ] }] };
  const s = buildSnapshot({ agents, work, summaries, usage: real, now });
  assert.equal(s.offline, false);
  if (s.offline) return;
  assert.equal(s.quotas[0].reset, 'repart à 15:10');
  assert.equal(s.quotas[1].engine, 'Claude · Fable');
});

test('euros', () => {
  assert.equal(euros(2.41), '2,41 $');
  assert.equal(euros(0), '0,00 $');
});

test('staysUnderPushLimit', () => {
  const many: Agent[] = Array.from({ length: 40 }, (_, i) => ({ ...agents[1], id: `a${i}`, name: `agent-${i}-${'x'.repeat(50)}` }));
  const longWork = Object.fromEntries(many.map((a) => [a.id, { subagents: Array.from({ length: 20 }, (_, j) => ({ id: `${a.id}-${j}`, description: 'd'.repeat(500), status: 'running', doing: 'y'.repeat(500) })) }]));
  const longSum = Object.fromEntries(many.map((a) => [a.id, { lastMessage: 'z'.repeat(5000) }]));
  const s = buildSnapshot({ agents: many, work: longWork, summaries: longSum, usage, now });
  assert.equal(s.offline, false);
  if (s.offline) return;
  assert.equal(s.agents.length, 30);
  assert.ok(JSON.stringify(s).length < 60000, `${JSON.stringify(s).length}`);
});

for (const [kind, ch] of [['accents', 'é'], ['quotes', '"'], ['CJK', '漢']] as const) {
  test(`staysUnderPushLimit in bytes with ${kind}`, () => {
    const many: Agent[] = Array.from({ length: 40 }, (_, i) => ({ ...agents[1], id: `a${i}`, name: ch.repeat(80) }));
    const longWork = Object.fromEntries(many.map((a) => [a.id, { subagents: Array.from({ length: 20 }, (_, j) => ({ id: `${a.id}-${j}`, description: ch.repeat(500), status: 'running', doing: ch.repeat(500) })) }]));
    const longSum = Object.fromEntries(many.map((a) => [a.id, { lastMessage: ch.repeat(5000) }]));
    const s = buildSnapshot({ agents: many, work: longWork, summaries: longSum, usage, now });
    assert.equal(s.offline, false);
    if (s.offline) return;
    assert.equal(s.agents.length, 30);
    assert.ok(Buffer.byteLength(JSON.stringify(s)) < 60000, `${Buffer.byteLength(JSON.stringify(s))}`);
    assert.ok(s.agents[0].last.length > 0, 'trims the message, does not drop it first');
  });
}

test('costs keep the 8 the widget shows', () => {
  const many: Agent[] = Array.from({ length: 12 }, (_, i) => ({ ...agents[1], id: `a${i}`, name: `a${i}`, cost: i }));
  const s = buildSnapshot({ agents: many, work: {}, summaries: {}, usage, now });
  if (s.offline) return assert.fail();
  assert.equal(s.costs.length, 8);
  assert.equal(s.costs[0].name, 'a11');
});

test('offlineSnapshot', () => {
  assert.deepEqual(offlineSnapshot(now), { v: 1, at: now, offline: true, message: 'Escouade ne répond pas' });
});
