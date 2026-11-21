// Turns Escouade's answers into what the PhoneBox widget shows, ready to display: the widget holds no logic.

export type Agent = {
  id: string; name: string; project: string; projectId: string;
  status: 'idle' | 'running' | 'waiting' | 'done' | 'error';
  waiting: boolean; requests: number; ticket: string | null; engine: string; model: string;
  cost: number; subagentsRunning: number; backgroundTasksRunning: number;
};
export type BackgroundWork = { subagents: { id: string; description: string; status: string; doing?: string | null }[] };
export type AgentSummary = { lastMessage: string | null };
export type Usage = {
  accounts: { name: string; engine: string; current: boolean; meters: { minutes: number | null; pct: number; resetsAt: string | null }[] }[];
};

export type Status = 'waiting' | 'running' | 'idle' | 'error' | 'done';
export type SubView = { id: string; desc: string; status: Status; doing: string };
export type AgentView = {
  id: string; name: string; project: string; status: Status; label: string; color: string; line: string; last: string;
  model: string; engine: string; ticket: string | null; cost: string; bg: number;
  subs: SubView[]; subsRunning: number; subsDone: number;
};
export type Snapshot =
  | {
      v: 1; at: number; offline: false;
      totals: { active: number; waiting: number; done: number; cost: string };
      quotas: { engine: string; win: string; pct: number; reset: string }[];
      costs: { name: string; cost: string; share: number }[];
      agents: AgentView[];
    }
  | { v: 1; at: number; offline: true; message: string };

const ORDER: Status[] = ['waiting', 'running', 'idle', 'error', 'done'];
const LABEL: Record<Status, string> = { waiting: 'Attend ta réponse', running: 'En cours', idle: 'Attend', error: 'Planté', done: 'Fini' };
const COLOR: Record<Status, string> = { waiting: '#f59e0b', running: '#22c55e', idle: '#22c55e', error: '#ef4444', done: '#5b6472' };
// Bounds that keep 30 agents under PhoneBox's 64 KB push (test staysUnderPushLimit).
const MAX_AGENTS = 30, MAX_SUBS = 5, NAME = 60, LINE = 90, LAST = 280, SUB = 60;

export const euros = (n: number) => `${n.toFixed(2).replace('.', ',')} $`;

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const statusOf = (a: Agent): Status => (a.waiting ? 'waiting' : a.status);

export function buildSnapshot(input: {
  agents: Agent[]; work: Record<string, BackgroundWork>; summaries: Record<string, AgentSummary>; usage: Usage; now: number;
}): Snapshot {
  const { agents, work, summaries, usage, now } = input;
  const sorted = agents
    .map((a, i) => ({ a, i, st: statusOf(a) }))
    .sort((x, y) => ORDER.indexOf(x.st) - ORDER.indexOf(y.st) || x.i - y.i)
    .slice(0, MAX_AGENTS);

  const views: AgentView[] = sorted.map(({ a, st }) => {
    const subs = work[a.id]?.subagents ?? [];
    const running = subs.filter((s) => s.status === 'running');
    const last = summaries[a.id]?.lastMessage ?? '';
    const firstParagraph = last.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
    return {
      id: a.id, name: cut(a.name, NAME), project: a.project, status: st, label: LABEL[st], color: COLOR[st],
      line: st === 'waiting' ? LABEL.waiting : cut(firstParagraph, LINE),
      last: cut(last, LAST), model: a.model, engine: a.engine, ticket: a.ticket, cost: euros(a.cost),
      bg: a.backgroundTasksRunning,
      subs: running.slice(0, MAX_SUBS).map((s) => ({ id: s.id, desc: cut(s.description, SUB), status: 'running', doing: cut(s.doing ?? '', SUB) })),
      subsRunning: running.length,
      subsDone: subs.filter((s) => s.status === 'done').length,
    };
  });

  const total = agents.reduce((sum, a) => sum + a.cost, 0);
  const max = Math.max(0, ...agents.map((a) => a.cost));
  const count = (...st: Status[]) => agents.filter((a) => st.includes(statusOf(a))).length;

  return {
    v: 1, at: now, offline: false,
    totals: { active: count('running', 'idle'), waiting: count('waiting'), done: count('done'), cost: euros(total) },
    quotas: usage.accounts.filter((acc) => acc.current).flatMap((acc) =>
      acc.meters.map((m) => ({ engine: engineName(acc.engine), win: windowOf(m.minutes), pct: Math.round(m.pct), reset: resetOf(m.resetsAt, now) }))),
    costs: [...agents]
      .sort((x, y) => y.cost - x.cost)
      .slice(0, MAX_AGENTS)
      .map((a) => ({ name: cut(a.name, NAME), cost: euros(a.cost), share: max ? a.cost / max : 0 })),
    agents: views,
  };
}

export const offlineSnapshot = (now: number): Snapshot => ({ v: 1, at: now, offline: true, message: 'Escouade ne répond pas' });

const engineName = (e: string) => e.charAt(0).toUpperCase() + e.slice(1);

function windowOf(minutes: number | null) {
  if (minutes === null) return 'mois';
  if (minutes === 300) return '5 h';
  if (minutes === 10080) return '7 j';
  return `${minutes} min`;
}

function resetOf(iso: string | null, now: number) {
  if (!iso) return '';
  const d = new Date(iso);
  if (d.toDateString() === new Date(now).toDateString()) {
    return `repart à ${new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(d)}`;
  }
  return `repart ${new Intl.DateTimeFormat('fr-FR', { weekday: 'long' }).format(d)}`;
}
