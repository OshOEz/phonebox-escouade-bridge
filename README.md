# phonebox-escouade-bridge

Shows [Escouade](https://escouade.dev) on the old Android phone that [PhoneBox](https://github.com/ersinkoc/phonebox)
turns into a desk panel: your agents and their sub-agents, their status, the quota, and Allow / Deny for an agent's
permission request on PhoneBox's own approval card.

A small process on your computer that talks to both local APIs. It changes nothing in Escouade or PhoneBox.

**Status: v1.** The study (in French) is in [docs/etude.md](docs/etude.md), the design in
[docs/superpowers/specs/2026-11-22-pont-v1-design.md](docs/superpowers/specs/2026-11-22-pont-v1-design.md).

## Setup

1. **Node 24** or later. No `npm install`: there are no dependencies.
2. **Escouade**: Settings › Harness › MCP server, turn on « Les agents peuvent piloter Escouade ». The bridge reads the
   server's address and token from `mcpServers.escouade` in `~/.claude.json`.
3. **PhoneBox**: turn on phone approvals for Claude Code (the bridge uses the same card).
4. Run the bridge:

   ```sh
   npm start
   ```

5. On PhoneBox, add a **Custom HTML** widget on a page of its own, as large as the page, and paste the whole of
   [widget/escouade.html](widget/escouade.html) into its HTML field.

Agents show up within 10 seconds. Tap an agent for its details, tap the line of numbers at the top for the quota and
the cost per agent.

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
