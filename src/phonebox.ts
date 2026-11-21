// PhoneBox's local agent: the push webhook, and the route of Claude Code's PermissionRequest hook, which holds the
// request open until the phone answers (or its delay runs out) and returns the decision.

export type PhoneBoxConfig = { url: string; token?: string };

export type PermissionRequest = {
  request: string;
  type: 'permission' | 'plan' | 'question';
  agent: { id: string; name: string; project: string; projectId: string; ticket: string | null };
  tool: string;
  arg?: string;
  input?: Record<string, unknown>;
  description: string | null;
};

const headers = (cfg: PhoneBoxConfig) => ({
  'content-type': 'application/json',
  ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}),
});

export async function push(cfg: PhoneBoxConfig, key: string, value: unknown): Promise<void> {
  const res = await fetch(`${cfg.url}/api/push/${key}`, { method: 'POST', headers: headers(cfg), body: JSON.stringify(value) });
  await res.body?.cancel();
  if (!res.ok) throw new Error(`PhoneBox a répondu ${res.status}`);
}

// The body Claude Code would send to the hook, so PhoneBox's card reads it as one of its own.
export function toHookBody(r: PermissionRequest, cwd: string): object {
  const input: Record<string, unknown> = { ...(r.input ?? {}) };
  if (r.type === 'plan') input.plan = r.arg;
  else if (!r.input && r.arg) input.command = r.arg;
  if (r.description) input.description = r.description;
  return { hook_event_name: 'PermissionRequest', session_id: r.agent.id, cwd, tool_name: r.tool, tool_input: input };
}

export async function askPermission(cfg: PhoneBoxConfig, body: object, signal: AbortSignal): Promise<'allow' | 'deny' | null> {
  const res = await fetch(`${cfg.url}/api/hooks/claude/permission`, { method: 'POST', headers: headers(cfg), body: JSON.stringify(body), signal });
  const text = await res.text();
  try {
    const behavior = JSON.parse(text)?.hookSpecificOutput?.decision?.behavior;
    return behavior === 'allow' || behavior === 'deny' ? behavior : null;
  } catch {
    return null; // Empty body: phone away, delay over, approvals off in PhoneBox.
  }
}
