// Starts the bridge with Escouade, starts it again when it dies, and copies what it says to the plugin's journal: the
// only place a plugin can show a state today (Plugins › this plugin › Journal).
import { createPlugin, type Plugin, type Program } from '@escouade-dev/plugin';

const COMMAND = 'phonebox-escouade-bridge';
const QUICK_MS = 10_000; // Dying sooner than this is a start failure (no MCP server, say), not a crash in use.
const MAX_MS = 300_000;

export function bridgePlugin({ restartMs = 5000 } = {}): Plugin {
  const plugin = createPlugin();
  let bridge: Program | undefined;
  let restart: ReturnType<typeof setTimeout> | undefined;
  let stopping = false;
  let delay = restartMs;

  const lines = (data: string) => data.split('\n').map((l) => l.trim()).filter(Boolean);

  async function launch() {
    restart = undefined;
    try {
      bridge = await plugin.runProgram({ command: COMMAND, args: [] }, (data, stream) => {
        for (const l of lines(data)) (stream === 'stderr' ? plugin.log.warn : plugin.log.info)(l);
      });
    } catch {
      // No retry: it would only repeat this line until the user links the command and presses Relancer.
      plugin.log.error(`Commande ${COMMAND} introuvable : dans le dossier du pont, lance npm run build puis npm link, puis Relancer ici.`);
      return;
    }
    plugin.log.info('Pont lancé');
    const since = Date.now();
    const code = await bridge.exited;
    bridge = undefined;
    if (stopping) return;
    // Back off while it keeps failing at start, so its error does not flood the journal every 5 s.
    const quick = Date.now() - since < QUICK_MS;
    if (!quick) delay = restartMs;
    plugin.log.warn(`Pont arrêté (code ${code}), relance dans ${delay / 1000} s`);
    restart = setTimeout(launch, delay);
    if (quick) delay = Math.min(delay * 2, MAX_MS);
  }

  // Launched at initialize, not on app.started: Relancer in the journal restarts the instance without that fact.
  plugin.onInitialize(() => void setTimeout(launch, 10)); // 10 ms: the least timer/set takes.
  plugin.onEvent('app.started', () => {}); // The fact only wakes the instance up.
  plugin.onShutdown(async () => {
    stopping = true;
    clearTimeout(restart);
    await bridge?.kill();
  });
  return plugin;
}
