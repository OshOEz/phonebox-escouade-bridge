# phonebox-escouade-bridge

Shows [Escouade](https://escouade.dev) on the old Android phone that [PhoneBox](https://github.com/ersinkoc/phonebox)
turns into a desk panel: your agents and their sub-agents, their status, the quota, and Allow / Deny for an agent's
permission request on PhoneBox's own approval card.

A small process on your computer that talks to both local APIs. It changes nothing in Escouade or PhoneBox.

**Status: v1.** The study (in French) is in [docs/etude.md](docs/etude.md), the design in
[docs/superpowers/specs/2026-11-22-pont-v1-design.md](docs/superpowers/specs/2026-11-22-pont-v1-design.md).

## Setup

1. **Node 24** or later. The bridge has no dependency at run time; `npm install` only fetches esbuild, which builds it.
2. **Escouade**: Settings › Harness › MCP server, turn on « Les agents peuvent piloter Escouade ». The bridge reads the
   server's address and token from `mcpServers.escouade` in `~/.claude.json`.
3. **PhoneBox**: turn on phone approvals for Claude Code (the bridge uses the same card).
4. Install the bridge as a command, in this folder:

   ```sh
   npm install && npm run build && npm link
   ```

5. Install the Escouade plugin, which starts the bridge with Escouade and stops it when you quit: see
   [Escouade plugin](#escouade-plugin). Without Escouade's plugin, `npm start` runs the bridge by hand.

The bridge sets up PhoneBox by itself: a page « Escouade » holding the widget, created on its first start and updated
when the widget changes. Nothing to paste. If your phone shows only some pages, the bridge adds this one to its list.

Agents show up within 10 seconds. Tap an agent for its details, tap the line of numbers at the top for the quota and
the cost per agent.

## Escouade plugin

The plugin in [plugin/](plugin) starts the bridge when Escouade starts, starts it again if it stops, and stops it when
you quit Escouade. It also stops by itself if Escouade crashes.

1. Install the bridge as a command (Setup, step 4): the plugin runs `phonebox-escouade-bridge`, nothing else.
2. In Escouade: Plugins › En développement › Charger un dossier…, and pick the `plugin` folder of this repository.
   The install window shows the one command it runs.

Its state is in Plugins › PhoneBox › Journal: « En marche », what the bridge says (« Escouade ne répond pas »,
« Page Escouade installée dans PhoneBox »…), and « Pont arrêté (code …), relance dans 5 s ». If the command is
missing, the journal says what to type; then press Relancer there.

To change the plugin: `cd plugin && npm install && npm test && npm run build`. `plugin/dist/plugin.mjs` is committed:
Escouade does not copy what Git ignores.

## Settings

| Variable | Default | What |
|---|---|---|
| `ESCOUADE_URL`, `ESCOUADE_TOKEN` | from `~/.claude.json` | Escouade's MCP server |
| `PHONEBOX_URL` | `http://127.0.0.1:8765` | PhoneBox's agent |
| `PHONEBOX_TOKEN` | none | PhoneBox's webhook token, if your setup asks for one |
| `BRIDGE_APPROVALS` | on | `0` stops relaying permissions (for example if PhoneBox's own Claude Code hook already catches Escouade's agents) |

## Tests

```sh
npm test
```

## License

MIT
