import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '@escouade-dev/plugin/testing';
import { bridgePlugin } from '../src/plugin.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A fake Escouade whose proc/spawn hands out 1, 2, 3… or throws when `missing`.
async function started(opts: { missing?: boolean } = {}) {
  const spawns: unknown[] = [];
  const kills: unknown[] = [];
  const fake = connect(bridgePlugin({ restartMs: 10 }), {
    host: {
      'proc/spawn': (params) => {
        spawns.push(params);
        if (opts.missing) throw new Error('not found');
        return { proc: spawns.length };
      },
      'proc/kill': (params) => (kills.push(params), null),
    },
  });
  await fake.initialize();
  await wait(5);
  const lines = (level: string) => fake.logs.filter((l) => l.level === level).map((l) => l.message);
  return { fake, spawns, kills, lines };
}

test('launches the bridge after initialize', async () => {
  const { spawns, lines } = await started();
  assert.deepEqual(spawns, [{ command: 'phonebox-escouade-bridge', args: [] }]);
  assert.ok(lines('info').includes('Pont lancé'));
});

test("copies the bridge's lines to the journal", async () => {
  const { fake, lines } = await started();
  await fake.notify('proc/out', { proc: 1, stream: 'stdout', data: 'a\n\nb\n' });
  await fake.notify('proc/out', { proc: 1, stream: 'stderr', data: 'x\n' });
  assert.deepEqual(lines('info').filter((l) => l !== 'Pont lancé'), ['a', 'b']);
  assert.deepEqual(lines('warn'), ['x']);
});

test('restarts after an exit', async () => {
  const { fake, spawns, lines } = await started();
  await fake.notify('proc/exit', { proc: 1, code: 1 });
  assert.ok(lines('warn').some((l) => l.includes('code 1')));
  await wait(20);
  assert.equal(spawns.length, 2);
});

test('says how to install when the command is missing', async () => {
  const { spawns, lines } = await started({ missing: true });
  assert.ok(lines('error').some((l) => l.includes('npm link')));
  await wait(50);
  assert.equal(spawns.length, 1);
});

test('kills the bridge on shutdown and does not restart', async () => {
  const { fake, spawns, kills } = await started();
  await fake.shutdown();
  assert.deepEqual(kills, [{ proc: 1 }]);
  await fake.notify('proc/exit', { proc: 1, code: null });
  await wait(20);
  assert.equal(spawns.length, 1);
});
