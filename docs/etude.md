# Étude : piloter Escouade depuis PhoneBox

Date : 2026-11-22. Versions lues : PhoneBox `main` (4679869), Escouade 2.2 (branche `feat/mode-serveur-web`).

## Le but

Voir et piloter [Escouade](https://escouade.dev) depuis le téléphone que [PhoneBox](https://github.com/ersinkoc/phonebox)
transforme en panneau de bureau : les agents qui attendent, le quota, les tickets prêts ou bloqués, et répondre
Autoriser / Refuser à une demande de permission d'un agent.

## La décision : un pont à part, sans toucher aux deux apps

Trois chemins étaient possibles :

| | Un outil réservé à Escouade | Une intégration poussée dans PhoneBox | **Un pont à part (retenu)** |
|---|---|---|---|
| Qui décide | nous | le mainteneur de PhoneBox | nous |
| Langage | libre | C# .NET 10 (`agent/PhoneBox.Agent/`) | libre |
| Rendu sur le téléphone | widgets génériques | cartes natives | widgets génériques + carte de permission |
| Risque | — | refus ou maintenance pour un outil de niche | une route interne de PhoneBox peut changer |

Pourquoi le pont :

- C'est déjà le modèle d'extension de PhoneBox : sa section « Community add-ons » liste des process externes qui
  passent par ses webhooks (PhoneBox Games Tab), et son pont Copilot CLI (`docs/copilot-cli-bridge.py`) fait pareil.
- PhoneBox n'a pas encore de système de plugins (`docs/ROADMAP.md`, issue #40, PR #46).
- Le même dépôt se présente aux deux communautés.
- Quand il aura des utilisateurs, une intégration native dans PhoneBox pourra suivre le patron de son intégration
  OpenCode (`OpenCodeApprovals.cs` : lire une API locale, montrer Allow/Deny, renvoyer la réponse). Ouvrir une issue
  avant d'écrire du C#.

## Pourquoi pas un plugin d'Escouade

Lu dans `docs/PLUGINS.md` et la spec d'Escouade (sujet *plugins*) :

1. Un plugin tourne en WASM isolé. `net/fetch` n'accepte que le https, jamais une adresse de la machine ni du réseau
   local. Or PhoneBox écoute sur `127.0.0.1:8765`.
2. `permissions/decide` coupe à 500 ms, puis la demande va à l'utilisateur : impossible d'attendre un tap sur le
   téléphone.
3. Les « canaux de notification déclarés » sont réservés au manifeste, pas construits.
4. Seul `contributes.commands` (une commande approuvée lancée à chaque fait) pourrait faire un `curl` vers
   PhoneBox : un sens seulement, un process par fait.

## Le canal côté Escouade : son serveur MCP

Serveur MCP « Streamable HTTP » sur `http://127.0.0.1:<port>/mcp` (port entre 47000 et 47999), boucle locale seule,
jeton `Authorization: Bearer`. Il tourne quand « Les agents peuvent piloter Escouade » est allumé (Réglages ›
Harness › Serveur MCP). Le jeton de « Claude (hors Escouade) » est déclaré en clair dans les configs des harness, par
exemple `mcpServers.escouade` de `~/.claude.json`.

| Besoin du téléphone | Outil MCP |
|---|---|
| Agents, statut, ce qui attend, coût | `list_agents`, `get_usage` |
| Permissions et questions en attente | `list_requests` (commande entière, plan, options) |
| Répondre | `answer_permission` (`allow` / `deny`), `answer_question` : toujours permis au jeton externe |
| Kanban, ticket prêt ou bloqué | `list_tickets`, `wait_ticket` (attente longue, 240 s au plus, curseur `since`) |
| Valider, renvoyer un ticket | `approve_ticket`, `reject_ticket` |

Garde-fous d'Escouade qu'on reçoit gratuitement : jamais « Toujours autoriser », et la carte dans Escouade dit
« Autorisé par Claude (hors Escouade) via Escouade ».

Limites :

- Pas de flux d'événements : il faut interroger `list_requests` (toutes les 1 à 2 s).
- L'API WebSocket du mode serveur d'Escouade (en cours, `docs/REMOTE.md`) poussera les événements, mais elle « suit
  la version de l'app » : pas un contrat pour des tiers. Ne pas construire dessus.

## Le canal côté PhoneBox : ses webhooks

L'agent PhoneBox écoute sur `127.0.0.1:8765` (`docs/GUIDE.md`, § Webhooks) :

- `POST /api/push/<clé>` : une valeur montrée par un widget « Pushed value » (`value`, `title`, `sub`, `level`…,
  `?ttl=` pour l'expiration) ;
- `POST /api/notify` : un toast avec vibration, `page` pour changer de page ;
- `POST /api/goto/<page>` ;
- `POST /api/hooks/claude/permission` : la route du hook `PermissionRequest` de Claude Code. Elle **bloque** jusqu'à
  la réponse du téléphone (ou son délai) et renvoie la décision. Route **interne** : elle marche, mais une version de
  PhoneBox peut la changer. Si le pont prend, proposer à PhoneBox une route publique « ask ».

## Le pont

```
Escouade MCP (127.0.0.1:47xxx/mcp) ◄──► pont ◄──► agent PhoneBox (127.0.0.1:8765)
  list_requests / list_agents          (sondage)     /api/push, /api/notify
  answer_permission                ◄── décision ──── /api/hooks/claude/permission (bloquant)
```

1. **v0, lecture** : `escouade.waiting`, `escouade.agents`, `escouade.usage` poussés vers `/api/push/<clé>` ;
   `/api/notify` pour « ticket prêt à tester » et « ticket bloqué ».
2. **v1, réponse** : chaque permission nouvelle de `list_requests` est envoyée, au format du hook Claude, à
   `/api/hooks/claude/permission` ; la décision revient par `answer_permission`. Une demande déjà répondue dans
   Escouade est refusée par Escouade (jamais deux réponses) : le pont l'ignore.
3. **Jeton** : lu dans `~/.claude.json` (`mcpServers.escouade`), ou donné par variable d'environnement.

Langage proposé : Node/TypeScript, un seul fichier, `fetch` pour les deux API, sans dépendance.

## À vérifier avant de coder

- **Le hook de PhoneBox capte-t-il déjà les agents d'Escouade ?** PhoneBox installe son hook `PermissionRequest`
  dans `~/.claude/settings.json`. Si les agents Claude Code lancés par Escouade lisent les réglages d'utilisateur,
  leurs permissions partent déjà au téléphone, en concurrence avec la carte d'Escouade. Chercher `setting-sources`
  dans `src-tauri/src` d'Escouade.
- Les noms et formats exacts des réponses MCP : `docs/PROTOCOL.md` d'Escouade.
- Le format exact attendu et renvoyé par `/api/hooks/claude/permission` : `ClaudeHook.cs` et le traitement de la
  route dans `Program.cs` de PhoneBox.

## Le chevauchement avec l'app mobile d'Escouade

Escouade prévoit sa propre app mobile (`docs/REMOTE.md`, étude ESC-445, Capacitor recommandé, décision encore
ouverte). PhoneBox reste complémentaire : un panneau posé sur le bureau qu'on lit d'un coup d'œil, pas une app
complète. À dire en une ligne en présentant le pont à la communauté Escouade.
