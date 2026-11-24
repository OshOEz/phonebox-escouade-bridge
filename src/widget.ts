// The « Escouade » page of PhoneBox, set by the bridge itself through PhoneBox's settings API, so nobody pastes HTML.
import { headers, type PhoneBoxConfig } from './phonebox.ts';

type Widget = { id: string; type: string; options?: Record<string, unknown>; [k: string]: unknown };
type Page = { id: string; widgets?: Widget[]; [k: string]: unknown };
export type Settings = { pages?: Page[]; phones?: { pages?: string[] | null }[]; [k: string]: unknown };

const PAGE = 'escouade';
// Beside src/ and dist/ alike: both are one level below the package.
export const WIDGET_HTML = new URL('../widget/escouade.html', import.meta.url);

const fullWidget = (html: string): Widget => ({ id: 'escouade-html', type: 'html', x: 0, y: 0, w: 12, h: 6, options: { html, transparent: true } });

// The config with the page set, or null when it already is: no write, so the phone does not reload for nothing.
export function withWidget(cfg: Settings, html: string): Settings | null {
  const out = structuredClone(cfg);
  let changed = false;
  out.pages ??= [];
  const page = out.pages.find((p) => p.id === PAGE);
  if (!page) {
    out.pages.push({ id: PAGE, title: 'Escouade', icon: '🛰️', enabled: true, widgets: [fullWidget(html)] });
    changed = true;
  } else {
    // Only the html: where the user moved or sized the widget, and the page's other widgets, stay theirs.
    const w = page.widgets?.find((x) => x.type === 'html');
    if (!w) {
      (page.widgets ??= []).push(fullWidget(html));
      changed = true;
    } else if (w.options?.html !== html) {
      w.options = { ...w.options, html };
      changed = true;
    }
  }
  // A phone that lists its pages shows only those (an empty list means all of them).
  for (const phone of out.phones ?? []) {
    if (phone.pages?.length && !phone.pages.includes(PAGE)) {
      phone.pages.push(PAGE);
      changed = true;
    }
  }
  return changed ? out : null;
}

// Two rounds at most: a 409 means someone saved in between, so read again once, never loop.
export async function installWidget(pb: PhoneBoxConfig, html: string): Promise<'installé' | 'à jour'> {
  for (let round = 0; ; round++) {
    const got = await fetch(`${pb.url}/api/settings`, { headers: headers(pb), signal: AbortSignal.timeout(10_000) });
    if (!got.ok) throw new Error(`PhoneBox a répondu ${got.status}`);
    const version = got.headers.get('x-config-version');
    const next = withWidget((await got.json()) as Settings, html);
    if (!next) return 'à jour';
    const put = await fetch(`${pb.url}/api/settings`, {
      method: 'PUT',
      headers: { ...headers(pb), ...(version ? { 'x-config-version': version } : {}) },
      body: JSON.stringify(next),
      signal: AbortSignal.timeout(10_000),
    });
    await put.body?.cancel();
    if (put.ok) return 'installé';
    if (put.status !== 409 || round === 1) throw new Error(`PhoneBox a répondu ${put.status}`);
  }
}
