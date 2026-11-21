// Escouade's local MCP server: one JSON-RPC `tools/call` per HTTP POST, no session needed.
import { readFileSync } from 'node:fs';

export type EscouadeConfig = { url: string; token: string };

export function loadConfig(env: NodeJS.ProcessEnv, claudeJsonPath: string): EscouadeConfig {
  if (env.ESCOUADE_URL && env.ESCOUADE_TOKEN) return { url: env.ESCOUADE_URL, token: env.ESCOUADE_TOKEN };
  try {
    const server = JSON.parse(readFileSync(claudeJsonPath, 'utf8'))?.mcpServers?.escouade;
    const auth: unknown = server?.headers?.Authorization;
    if (typeof server?.url === 'string' && typeof auth === 'string') {
      return { url: server.url, token: auth.replace(/^Bearer\s+/i, '') };
    }
  } catch {
    // No file or no JSON: same answer as no entry.
  }
  throw new Error('Jeton Escouade introuvable : définis ESCOUADE_URL et ESCOUADE_TOKEN');
}

let nextId = 1;

export async function callTool<T = unknown>(cfg: EscouadeConfig, name: string, args: object = {}, signal?: AbortSignal): Promise<T> {
  const res = await fetch(cfg.url, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${cfg.token}`,
      'mcp-protocol-version': '2025-11-25',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }),
  });
  if (!res.ok) throw new Error(`Escouade a répondu ${res.status}`);
  const text = await res.text();
  const msg = (res.headers.get('content-type') ?? '').includes('text/event-stream') ? lastSseMessage(text) : JSON.parse(text);
  if (msg.error) throw new Error(`Escouade : ${msg.error.message ?? 'erreur'}`);
  const result = msg.result ?? {};
  const first = result.content?.[0]?.text;
  if (result.isError) throw new Error(`Escouade : ${first ?? 'erreur'}`);
  return (result.structuredContent ?? JSON.parse(first)) as T;
}

function lastSseMessage(text: string) {
  const datas = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
  const found = datas.reverse().find((d) => d.includes('"result"') || d.includes('"error"'));
  if (!found) throw new Error('Escouade : réponse SSE sans résultat');
  return JSON.parse(found);
}
