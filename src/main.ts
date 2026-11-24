// The bridge: polls Escouade, pushes the agents to PhoneBox's widget, and relays permissions to PhoneBox's card.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { loadConfig, callTool } from './escouade.ts';
import { push, askPermission, type PhoneBoxConfig, type PermissionRequest } from './phonebox.ts';
import { buildSnapshot, offlineSnapshot, type Agent, type BackgroundWork, type AgentSummary, type Usage, type Snapshot } from './snapshot.ts';
import { ApprovalRelay, answerArgs } from './approvals.ts';
import { installWidget, WIDGET_HTML } from './widget.ts';

const REQUESTS_MS = 2000;
const SNAPSHOT_EVERY = 3; // ticks: the agents every 6 s.

const escouade = loadConfig(process.env, join(homedir(), '.claude.json'));
const phonebox: PhoneBoxConfig = { url: process.env.PHONEBOX_URL ?? 'http://127.0.0.1:8765', token: process.env.PHONEBOX_TOKEN };
const relayOn = process.env.BRIDGE_APPROVALS !== '0';
const log = (line: string) => console.log(`${new Date().toLocaleTimeString('fr-FR')} ${line}`);

// 10 s at most: a hung Escouade shows as offline instead of stalling the loop.
const call = <T>(name: string, args: object = {}) => callTool<T>(escouade, name, args, AbortSignal.timeout(10_000));
const TTL = 60; // PhoneBox drops the agents a minute after the bridge stops pushing.
const REFRESH_MS = 30_000; // So a running bridge pushes at least this often.
// Escouade sends lists bare (seen 2026-11-22); an object holding one is read too, should that change.
const list = <T>(x: unknown): T[] => (Array.isArray(x) ? x : (Object.values(x ?? {}).find(Array.isArray) as T[]) ?? []);

let paths: Record<string, string> = {};
const relay = new ApprovalRelay({
  ask: (body, signal) => askPermission(phonebox, body, signal),
  answer: async (r, decision) => { await call('answer_permission', answerArgs(r, decision)); },
  cwdOf: (projectId) => paths[projectId] ?? '',
  log,
});

// Never throws: PhoneBox away now is tried again when it answers (see sendIfChanged).
async function ensureWidget() {
  try {
    if ((await installWidget(phonebox, await readFile(WIDGET_HTML, 'utf8'))) === 'installé') log('Page Escouade installée dans PhoneBox');
  } catch (err) {
    log(`PhoneBox : page Escouade non installée : ${(err as Error).message}`);
  }
}

let lastSent = '';
let lastSentAt = 0;
let offline = false;
let pushFailing = false;

// A PhoneBox failure is logged as such and never turns into the « Escouade ne répond pas » screen.
async function sendIfChanged(s: Snapshot) {
  const { at: _at, ...rest } = s;
  const key = JSON.stringify(rest);
  if (key === lastSent && Date.now() - lastSentAt < REFRESH_MS) return;
  try {
    await push(phonebox, 'escouade', s, TTL);
    lastSent = key;
    lastSentAt = Date.now();
    if (pushFailing) {
      log('PhoneBox reçoit de nouveau');
      void ensureWidget();
    }
    pushFailing = false;
  } catch (err) {
    if (!pushFailing) log(`PhoneBox refuse l'envoi : ${(err as Error).message}`);
    pushFailing = true;
  }
}

async function snapshot() {
  const [agents, usage, projects] = await Promise.all([
    call<unknown>('list_agents').then((x) => list<Agent>(x)),
    call<Usage>('get_usage'),
    call<unknown>('list_projects').then((x) => list<{ id: string; path: string }>(x)),
  ]);
  paths = Object.fromEntries(projects.map((p) => [p.id, p.path]));
  const work: Record<string, BackgroundWork> = {};
  const summaries: Record<string, AgentSummary> = {};
  await Promise.all(agents.map(async (a) => {
    const ref = { agent: a.id, project: a.projectId };
    // An agent archived between the two calls only loses its details, not the whole screen.
    summaries[a.id] = await call<AgentSummary>('get_agent_summary', ref).catch(() => ({ lastMessage: null }));
    if (a.subagentsRunning > 0) {
      const w = await call<BackgroundWork>('list_background_work', ref).catch(() => undefined);
      if (w) work[a.id] = w;
    }
  }));
  await sendIfChanged(buildSnapshot({ agents, work, summaries, usage, now: Date.now() }));
}

// Escouade killed or crashed: the bridge it started is re-parented, so stop instead of running orphaned.
const parent = process.ppid;
let n = 0;
async function tick() {
  if (process.ppid !== parent) {
    log("Escouade n'est plus là : arrêt du pont");
    relay.sync([]);
    process.exit(0);
  }
  try {
    if (relayOn) relay.sync(list<PermissionRequest>(await call('list_requests')));
    if (n++ % SNAPSHOT_EVERY === 0) await snapshot();
    if (offline) log('Escouade répond de nouveau');
    offline = false;
  } catch (err) {
    if (!offline) {
      log(`Escouade ne répond pas : ${(err as Error).message}`);
    }
    offline = true;
    await sendIfChanged(offlineSnapshot(Date.now()));
  }
}

log(`Escouade ${escouade.url} → PhoneBox ${phonebox.url}${relayOn ? '' : ' (approbations coupées)'}`);
process.on('SIGINT', () => {
  relay.sync([]); // Takes every card off the phone.
  process.exit(0);
});
await ensureWidget();
// One tick at a time: a slow Escouade never piles up calls.
for (;;) {
  await tick();
  await new Promise((r) => setTimeout(r, REQUESTS_MS));
}
