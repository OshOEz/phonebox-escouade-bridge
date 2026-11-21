// Answers of Escouade's MCP tools, shaped as docs/PROTOCOL.md of Escouade says (only the fields the bridge reads).
import type { Agent, BackgroundWork, AgentSummary, Usage } from '../../src/snapshot.ts';

const agent = (id: string, status: Agent['status'], extra: Partial<Agent> = {}): Agent => ({
  id, name: id, project: 'demo-api', projectId: 'p1', status, waiting: false, requests: 0, ticket: null,
  engine: 'claude', model: 'Sonnet 5.5', cost: 0, subagentsRunning: 0, backgroundTasksRunning: 0, ...extra,
});

export const agents: Agent[] = [
  agent('dem-6-limiter', 'done', { ticket: 'DEM-6', cost: 1.2 }),
  agent('refacto-auth', 'running', { ticket: 'DEM-4', model: 'Opus 5.5', cost: 2.41, subagentsRunning: 1, backgroundTasksRunning: 4 }),
  agent('tests-e2e', 'running', { waiting: true, requests: 1, ticket: 'DEM-7', cost: 0.22 }),
  agent('pagination-users', 'running', { ticket: 'DEM-3', cost: 0.14, subagentsRunning: 2 }),
  agent('dem-5-export-csv', 'idle', { engine: 'codex', model: 'GPT-5.5', ticket: 'DEM-5', cost: 0.41, backgroundTasksRunning: 1 }),
];

const sub = (id: string, status: string, description: string, doing = '') => ({ id, description, status, doing, subagentType: 'Explore', model: 'Haiku 4.5' });

export const work: Record<string, BackgroundWork> = {
  'refacto-auth': {
    subagents: [
      sub('s1', 'running', 'Third rebase of the stack', 'git rebase --onto main'),
      ...Array.from({ length: 18 }, (_, i) => sub(`d${i}`, 'done', `fini ${i}`)),
    ],
  },
  'pagination-users': {
    subagents: [sub('s2', 'running', 'Écrire les tests de la pagination', 'cas du dernier curseur'), sub('s3', 'running', 'Lister les appelants de /users', 'Grep fetchUsers(')],
  },
};

export const summaries: Record<string, AgentSummary> = {
  'refacto-auth': { lastMessage: 'Le jeton est signé en ES256.\n\nIl reste la rotation des clés.' },
  'tests-e2e': { lastMessage: 'Je lance toute la suite e2e ?' },
};

export const now = new Date(2026, 10, 22, 14, 0).getTime();

export const usage: Usage = {
  accounts: [
    { name: 'Principal', engine: 'claude', current: true, meters: [
      { minutes: 300, pct: 22.4, resetsAt: new Date(2026, 10, 22, 15, 10).toISOString() },
      { minutes: 10080, pct: 36, resetsAt: new Date(2026, 10, 26, 9, 0).toISOString() },
    ] },
    { name: 'Second', engine: 'claude', current: false, meters: [{ minutes: 300, pct: 90, resetsAt: null }] },
  ],
};
