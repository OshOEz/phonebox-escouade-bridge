// Sends each new permission of Escouade to PhoneBox's card, and carries the phone's answer back. One the phone left
// unanswered (away, delay over, unreachable) is offered again a minute later while Escouade still waits for it.
import { toHookBody, type PermissionRequest } from './phonebox.ts';

export type Deps = {
  ask: (body: object, signal: AbortSignal) => Promise<'allow' | 'deny' | null>;
  answer: (r: PermissionRequest, decision: 'allow' | 'deny') => Promise<void>;
  cwdOf: (projectId: string) => string;
  log: (line: string) => void;
  now?: () => number;
};

const RETRY_MS = 60_000;

// The arguments of Escouade's answer_permission: the agent is required, the project tells two same-named agents apart.
export const answerArgs = (r: PermissionRequest, decision: 'allow' | 'deny') =>
  ({ agent: r.agent.id, project: r.agent.projectId, request: r.request, decision });

export class ApprovalRelay {
  #deps: Deps;
  #retryAt = new Map<string, number>(); // Infinity: on the phone or answered.
  #flying = new Map<string, AbortController>();

  constructor(deps: Deps) {
    this.#deps = deps;
  }

  // `requests`: the whole answer of list_requests.
  sync(requests: PermissionRequest[]): void {
    const listed = new Set(requests.map((r) => r.request));
    for (const [id, ctl] of this.#flying) {
      if (!listed.has(id)) {
        ctl.abort(); // Answered in Escouade: take the card off the phone.
        this.#flying.delete(id);
      }
    }
    for (const id of this.#retryAt.keys()) if (!listed.has(id)) this.#retryAt.delete(id);
    const now = this.#now();
    for (const r of requests) {
      if (r.type === 'question' || (this.#retryAt.get(r.request) ?? 0) > now) continue;
      this.#retryAt.set(r.request, Infinity);
      this.#forward(r);
    }
  }

  #now() {
    return (this.#deps.now ?? Date.now)();
  }

  #later(id: string) {
    if (this.#retryAt.has(id)) this.#retryAt.set(id, this.#now() + RETRY_MS);
  }

  inFlight(): string[] {
    return [...this.#flying.keys()];
  }

  async #forward(r: PermissionRequest) {
    const ctl = new AbortController();
    this.#flying.set(r.request, ctl);
    try {
      const decision = await this.#deps.ask(toHookBody(r, this.#deps.cwdOf(r.agent.projectId)), ctl.signal);
      if (ctl.signal.aborted) return;
      if (!decision) return this.#later(r.request);
      await this.#deps.answer(r, decision);
    } catch (err) {
      if (ctl.signal.aborted) return;
      this.#deps.log(`${r.agent.name} : ${(err as Error).message}`);
      this.#later(r.request);
    } finally {
      if (this.#flying.get(r.request) === ctl) this.#flying.delete(r.request);
    }
  }
}
