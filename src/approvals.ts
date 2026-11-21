// Sends each new permission of Escouade to PhoneBox's card once, and carries the phone's answer back.
import { toHookBody, type PermissionRequest } from './phonebox.ts';

export type Deps = {
  ask: (body: object, signal: AbortSignal) => Promise<'allow' | 'deny' | null>;
  answer: (request: string, decision: 'allow' | 'deny') => Promise<void>;
  cwdOf: (projectId: string) => string;
  log: (line: string) => void;
};

export class ApprovalRelay {
  #deps: Deps;
  #seen = new Set<string>();
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
    for (const id of this.#seen) if (!listed.has(id)) this.#seen.delete(id);
    for (const r of requests) {
      if (r.type === 'question' || this.#seen.has(r.request)) continue;
      this.#seen.add(r.request);
      this.#forward(r);
    }
  }

  inFlight(): string[] {
    return [...this.#flying.keys()];
  }

  async #forward(r: PermissionRequest) {
    const ctl = new AbortController();
    this.#flying.set(r.request, ctl);
    try {
      const decision = await this.#deps.ask(toHookBody(r, this.#deps.cwdOf(r.agent.projectId)), ctl.signal);
      if (ctl.signal.aborted || !decision) return;
      await this.#deps.answer(r.request, decision);
    } catch (err) {
      if (!ctl.signal.aborted) this.#deps.log(`${r.agent.name} : ${(err as Error).message}`);
    } finally {
      if (this.#flying.get(r.request) === ctl) this.#flying.delete(r.request);
    }
  }
}
