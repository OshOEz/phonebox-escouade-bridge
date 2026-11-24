import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withWidget, installWidget, type Settings } from '../src/widget.ts';
import { stub } from './server.ts';

const H = '<div>escouade</div>';
const page = (widgets: unknown[]) => ({ id: 'escouade', title: 'Escouade', icon: '🛰️', enabled: true, widgets });
const full = (html: string) => ({ id: 'escouade-html', type: 'html', x: 0, y: 0, w: 12, h: 6, options: { html, transparent: true } });

test('creates the page when missing', () => {
  const out = withWidget({ pages: [{ id: 'home', widgets: [] } as any], theme: 'x' }, H)!;
  assert.deepEqual(out.pages![0], { id: 'home', widgets: [] });
  assert.deepEqual(out.pages![1], page([full(H)]));
  assert.equal(out.theme, 'x');
});

test('replaces only the html of an existing page', () => {
  const note = { id: 'n', type: 'note', x: 8, y: 0, w: 4, h: 2, options: { text: 'hi' } };
  const html = { id: 'w', type: 'html', x: 2, y: 0, w: 6, h: 6, options: { html: 'old', transparent: false } };
  const out = withWidget({ pages: [page([note, html]) as any] }, H)!;
  assert.deepEqual(out.pages![0].widgets, [note, { ...html, options: { html: H, transparent: false } }]);
});

test('adds an html widget to an existing page that has none', () => {
  const out = withWidget({ pages: [page([]) as any] }, H)!;
  assert.deepEqual(out.pages![0].widgets, [full(H)]);
});

test('returns null when nothing changes', () => {
  assert.equal(withWidget({ pages: [page([full(H)]) as any], phones: [{ pages: [] }, { pages: null }] }, H), null);
});

test('adds the page to a phone that lists its pages', () => {
  const out = withWidget({ pages: [page([full(H)]) as any], phones: [{ pages: ['home'] }] }, H)!;
  assert.deepEqual(out.phones![0].pages, ['home', 'escouade']);
});

test('does not mutate its input', () => {
  const cfg: Settings = { pages: [page([{ ...full('old') }]) as any], phones: [{ pages: ['home'] }] };
  const before = structuredClone(cfg);
  withWidget(cfg, H);
  assert.deepEqual(cfg, before);
});

// A fake PhoneBox: GET answers the config and its version, PUT answers the statuses given in order.
async function phonebox(cfg: Settings, puts: number[] = [200]) {
  const seen = { gets: 0, puts: [] as { version: string | undefined; type: string | undefined; body: any }[] };
  const s = await stub((req, body, res) => {
    if (req.method === 'GET' && req.url === '/api/settings') {
      seen.gets++;
      res.writeHead(200, { 'content-type': 'application/json', 'x-config-version': String(41 + seen.gets) });
      res.end(JSON.stringify(cfg));
    } else if (req.method === 'PUT' && req.url === '/api/settings') {
      seen.puts.push({ version: req.headers['x-config-version'] as string, type: req.headers['content-type'], body: JSON.parse(body) });
      res.writeHead(puts[seen.puts.length - 1] ?? 200).end();
    } else res.writeHead(404).end();
  });
  return { ...s, seen };
}

test('GET then PUT with the version', async (t) => {
  const pb = await phonebox({ pages: [] });
  t.after(pb.close);
  assert.equal(await installWidget({ url: pb.url }, H), 'installé');
  assert.equal(pb.seen.puts.length, 1);
  assert.equal(pb.seen.puts[0].version, '42');
  assert.match(pb.seen.puts[0].type!, /^application\/json/);
  assert.deepEqual(pb.seen.puts[0].body.pages, [page([full(H)])]);
});

test('does not PUT when up to date', async (t) => {
  const pb = await phonebox({ pages: [page([full(H)]) as any] });
  t.after(pb.close);
  assert.equal(await installWidget({ url: pb.url }, H), 'à jour');
  assert.equal(pb.seen.puts.length, 0);
});

test('retries once on 409', async (t) => {
  const pb = await phonebox({ pages: [] }, [409, 200]);
  t.after(pb.close);
  assert.equal(await installWidget({ url: pb.url }, H), 'installé');
  assert.equal(pb.seen.gets, 2);
  assert.deepEqual(pb.seen.puts.map((p) => p.version), ['42', '43']);
});

test('gives up after a second 409', async (t) => {
  const pb = await phonebox({ pages: [] }, [409, 409, 200]);
  t.after(pb.close);
  await assert.rejects(installWidget({ url: pb.url }, H), /409/);
  assert.equal(pb.seen.puts.length, 2);
});

test('rejects when PhoneBox is down', async () => {
  await assert.rejects(installWidget({ url: 'http://127.0.0.1:1' }, H));
});
