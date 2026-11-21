import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, callTool } from '../src/escouade.ts';
import { stub } from './server.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'pont-'));

test('loadConfig prefers env', () => {
  const cfg = loadConfig({ ESCOUADE_URL: 'http://127.0.0.1:47001/mcp', ESCOUADE_TOKEN: 't' }, join(tmp(), 'absent.json'));
  assert.deepEqual(cfg, { url: 'http://127.0.0.1:47001/mcp', token: 't' });
});

test('loadConfig reads ~/.claude.json', () => {
  const f = join(tmp(), '.claude.json');
  writeFileSync(f, JSON.stringify({ mcpServers: { escouade: { type: 'http', url: 'http://127.0.0.1:47002/mcp', headers: { Authorization: 'Bearer abc' } } } }));
  assert.deepEqual(loadConfig({}, f), { url: 'http://127.0.0.1:47002/mcp', token: 'abc' });
});

test('loadConfig throws without token', () => {
  assert.throws(() => loadConfig({}, join(tmp(), 'absent.json')), { message: 'Jeton Escouade introuvable : définis ESCOUADE_URL et ESCOUADE_TOKEN' });
});

test('callTool parses JSON', async (t) => {
  const s = await stub((req, body, res) => {
    assert.equal(req.headers.authorization, 'Bearer t');
    assert.equal(JSON.parse(body).params.name, 'list_agents');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '[{"id":"a"}]' }] } }));
  });
  t.after(s.close);
  assert.deepEqual(await callTool({ url: `${s.url}/mcp`, token: 't' }, 'list_agents'), [{ id: 'a' }]);
});

test('callTool parses SSE', async (t) => {
  const s = await stub((_req, _body, res) => {
    res.setHeader('content-type', 'text/event-stream');
    res.end('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"structuredContent":{"ok":true}}}\n\n');
  });
  t.after(s.close);
  assert.deepEqual(await callTool({ url: `${s.url}/mcp`, token: 't' }, 'get_usage'), { ok: true });
});

test('callTool throws on isError without leaking token', async (t) => {
  const s = await stub((_req, _body, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: 'Ce sous-agent ne tourne plus.' }] } }));
  });
  t.after(s.close);
  await assert.rejects(callTool({ url: `${s.url}/mcp`, token: 'secret-token' }, 'message_subagent'), (err: Error) => {
    assert.match(err.message, /Ce sous-agent ne tourne plus\./);
    assert.doesNotMatch(err.message, /secret-token|Bearer/);
    return true;
  });
});

test('callTool throws on HTTP error', async (t) => {
  const s = await stub((_req, _body, res) => { res.statusCode = 401; res.end('no'); });
  t.after(s.close);
  await assert.rejects(callTool({ url: `${s.url}/mcp`, token: 't' }, 'list_agents'), { message: 'Escouade a répondu 401' });
});
