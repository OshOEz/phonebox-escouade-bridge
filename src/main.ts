// The bridge: polls Escouade, pushes the agents to PhoneBox's widget, and relays permissions to PhoneBox's card.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, callTool } from './escouade.ts';
import { push, askPermission, type PhoneBoxConfig, type PermissionRequest } from './phonebox.ts';
import { buildSnapshot, offlineSnapshot, type Agent, type BackgroundWork, type AgentSummary, type Usage, type Snapshot } from './snapshot.ts';
import { ApprovalRelay } from './approvals.ts';

const REQUESTS_MS = 2000;
const SNAPSHOT_EVERY = 3; // ticks: the agents every 6 s.

const escouade = loadConfig(process.env, join(homedir(), '.claude.json'));
const phonebox: PhoneBoxConfig = { url: process.env.PHONEBOX_URL ?? 'http://127.0.0.1:8765', token: process.env.PHONEBOX_TOKEN };
const relayOn = process.env.BRIDGE_APPROVALS !== '0';
const log = (line: string) => console.log(`${new Date().toLocaleTimeString('fr-FR')} ${line}`);

const call = <T>(name: string, args: object = {}) => callTool<T>(escouade, name, args);
// Escouade sends lists bare (seen 2026-11-22); an object holding one is read too, should that change.
const list = <T>(x: unknown): T[] => (Array.isArray(x) ? x : (Object.values(x ?? {}).find(Array.isArray) as T[]) ?? []);

let paths: Record<string, string> = {};
const relay = new ApprovalRelay({
  ask: (body, signal) => askPermission(phonebox, body, signal),
  answer: async (request, decision) => { await call('answer_permission', { request, decision }); },
  cwdOf: (projectId) => paths[projectId] ?? '',
  log,
});

let lastSent = '';
let offline = false;

async function sendIfChanged(s: Snapshot) {
  const { at: _at, ...rest } = s;
  const key = JSON.stringify(rest);
  if (key === lastSent) return;
  await push(phonebox, 'escouade', s);
  lastSent = key;
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
    summaries[a.id] = await call<AgentSummary>('get_agent_summary', ref);
    if (a.subagentsRunning > 0) work[a.id] = await call<BackgroundWork>('list_background_work', ref);
  }));
  await sendIfChanged(buildSnapshot({ agents, work, summaries, usage, now: Date.now() }));
}

let n = 0;
async function tick() {
  try {
    if (relayOn) relay.sync(list<PermissionRequest>(await call('list_requests')));
    if (n++ % SNAPSHOT_EVERY === 0) await snapshot();
    if (offline) log('Escouade répond de nouveau');
    offline = false;
  } catch (err) {
    if (!offline) {
      log(`Escouade ou PhoneBox ne répond pas : ${(err as Error).message}`);
      await sendIfChanged(offlineSnapshot(Date.now())).catch(() => {});
    }
    offline = true;
  }
}

log(`Escouade ${escouade.url} → PhoneBox ${phonebox.url}${relayOn ? '' : ' (approbations coupées)'}`);
process.on('SIGINT', () => {
  relay.sync([]); // Takes every card off the phone.
  process.exit(0);
});
// One tick at a time: a slow Escouade never piles up calls.
for (;;) {
  await tick();
  await new Promise((r) => setTimeout(r, REQUESTS_MS));
}
