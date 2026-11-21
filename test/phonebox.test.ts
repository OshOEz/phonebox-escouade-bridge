import { test } from 'node:test';
import assert from 'node:assert/strict';
import { push, askPermission, toHookBody, type PermissionRequest } from '../src/phonebox.ts';
import { stub } from './server.ts';

const req = (extra: Partial<PermissionRequest> = {}): PermissionRequest => ({
  request: 'r1', type: 'permission', tool: 'Bash', arg: 'git push', description: null,
  agent: { id: 'ag1', name: 'refacto-auth', project: 'demo-api', projectId: 'p1', ticket: 'DEM-4' }, ...extra,
});

test('push posts JSON to the key', async (t) => {
  let seen: { path?: string; type?: string; body?: unknown } = {};
  const s = await stub((r, body, res) => { seen = { path: r.url, type: r.headers['content-type'], body: JSON.parse(body) }; res.end(); });
  t.after(s.close);
  await push({ url: s.url }, 'escouade', { a: 1 });
  assert.deepEqual(seen, { path: '/api/push/escouade', type: 'application/json', body: { a: 1 } });
});

test('push sends the optional token', async (t) => {
  let auth: string | undefined;
  const s = await stub((r, _b, res) => { auth = r.headers.authorization; res.end(); });
  t.after(s.close);
  await push({ url: s.url, token: 'w' }, 'escouade', 1);
  assert.equal(auth, 'Bearer w');
});

test('push throws on HTTP error', async (t) => {
  const s = await stub((_r, _b, res) => { res.statusCode = 413; res.end(); });
  t.after(s.close);
  await assert.rejects(push({ url: s.url }, 'escouade', 1), { message: 'PhoneBox a répondu 413' });
});

const answering = (text: string) => stub((r, _b, res) => { assert.equal(r.url, '/api/hooks/claude/permission'); res.end(text); });

test('askPermission allow', async (t) => {
  const s = await answering('{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}');
  t.after(s.close);
  assert.equal(await askPermission({ url: s.url }, {}, new AbortController().signal), 'allow');
});

test('askPermission deny', async (t) => {
  const s = await answering('{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"Denied from the PhoneBox panel."}}}');
  t.after(s.close);
  assert.equal(await askPermission({ url: s.url }, {}, new AbortController().signal), 'deny');
});

test('askPermission empty body → null', async (t) => {
  const s = await answering('');
  t.after(s.close);
  assert.equal(await askPermission({ url: s.url }, {}, new AbortController().signal), null);
});

test('askPermission throws on HTTP error', async (t) => {
  const s = await stub((_r, _b, res) => { res.statusCode = 401; res.end(); });
  t.after(s.close);
  await assert.rejects(askPermission({ url: s.url }, {}, new AbortController().signal), { message: 'PhoneBox a répondu 401' });
});

test('push passes the ttl', async (t) => {
  let path: string | undefined;
  const s = await stub((r, _b, res) => { path = r.url; res.end(); });
  t.after(s.close);
  await push({ url: s.url }, 'escouade', 1, 60);
  assert.equal(path, '/api/push/escouade?ttl=60');
});

test('toHookBody Bash', () => {
  const b = toHookBody(req(), '/dev/demo-api') as any;
  assert.equal(b.hook_event_name, 'PermissionRequest');
  assert.equal(b.session_id, 'ag1');
  assert.equal(b.cwd, '/dev/demo-api');
  assert.equal(b.tool_name, 'Bash');
  assert.deepEqual(b.tool_input, { command: 'git push' });
});

test('toHookBody keeps input', () => {
  const b = toHookBody(req({ tool: 'Write', arg: 'a.ts', input: { file_path: 'a.ts', content: 'x' } }), '/d') as any;
  assert.deepEqual(b.tool_input, { file_path: 'a.ts', content: 'x' });
});

test('toHookBody plan', () => {
  const b = toHookBody(req({ type: 'plan', tool: 'ExitPlanMode', arg: '1. faire' }), '/d') as any;
  assert.equal(b.tool_name, 'ExitPlanMode');
  assert.equal(b.tool_input.plan, '1. faire');
});
