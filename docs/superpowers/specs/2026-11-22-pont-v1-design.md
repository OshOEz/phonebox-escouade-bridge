# Pont v1 : les agents d'Escouade et leurs approbations sur PhoneBox

Date : 2026-11-22. Part de l'étude [docs/etude.md](../../etude.md).

## Le but

Sur le téléphone PhoneBox posé sur le bureau, sans toucher ni à Escouade ni à PhoneBox :

1. voir les agents qui tournent, leur statut et leurs sous-agents, organisés comme dans Escouade (liste à gauche,
   détail à droite, une entrée « vue d'ensemble » en tête) ;
2. répondre Autoriser / Refuser aux permissions des agents ;
3. dans la DA de PhoneBox (choix de l'utilisateur : maquette **D**).

Hors périmètre : parler à un agent en maintenant le doigt (impossible sans changer PhoneBox : l'iframe du widget n'a
ni micro ni voie de retour) ; notifications de tickets ; questions (`AskUserQuestion`) : elles restent dans Escouade.

## Les maquettes retenues

- `docs/maquettes/PhoneBox.dc.html` (D) : la page du widget. Carte « ESCOUADE » à gauche (ligne de stats globales,
  puis les agents, sous-agents en `└` dessous) ; à droite le détail de l'agent touché (statut, nom, dernier message,
  4 tuiles, la liste des sous-agents) ou, sur la ligne de stats, le quota en tuiles et
  le coût du jour par agent.
- `docs/maquettes/ApprobationNative.dc.html` : la carte d'approbation native de PhoneBox (rien à construire).
- Écart avec la maquette : le MCP d'Escouade ne donne ni durée, ni tokens, ni température du cache d'un agent. Les
  4 tuiles deviennent Coût / Modèle / Ticket / En fond.
- Canvas complet : https://claude.ai/artifact/S3JrhM1DhUfgmDwKfEjVBd (privé).

## Architecture

Un process Node sur le PC, sans dépendance :

```
Escouade MCP (127.0.0.1:47xxx/mcp) ◄── sondage ── pont ── push ──► PhoneBox /api/push/escouade ──► widget Custom HTML
                                   ◄── answer_permission ── pont ◄── décision ── /api/hooks/claude/permission (bloquant)
```

- **Liste** : le pont lit `list_agents`, `list_background_work` (agents avec sous-agents), `get_agent_summary`
  (dernier message) et `get_usage`, construit un instantané compact, et le pousse sous la clé `escouade` quand il
  change. Le widget n'a aucune logique métier : il affiche les champs déjà prêts et garde localement la ligne touchée.
- **Approbation** : chaque permission nouvelle de `list_requests` (`type` `permission` ou `plan`) est envoyée au
  format du hook Claude Code à la route bloquante de PhoneBox ; la décision revient par `answer_permission`. Corps
  vide (téléphone absent, délai, approbations coupées dans PhoneBox) : on ne fait rien, la demande reste dans Escouade.
  Une demande qui disparaît de `list_requests` (répondue dans Escouade) annule l'appel en cours.

## Contraintes

- Node ≥ 24 (TypeScript lu tel quel, `node --test`), aucune dépendance npm.
- Boucle locale seulement : Escouade et PhoneBox sur `127.0.0.1`.
- Jeton Escouade : `ESCOUADE_URL` + `ESCOUADE_TOKEN`, sinon `mcpServers.escouade` de `~/.claude.json` (`url`,
  `headers.Authorization`). Jamais écrit dans un log.
- Push PhoneBox : 64 Ko au plus par valeur, clé `^[A-Za-z0-9_.\-]{1,64}$`.
- Les réponses MCP arrivent en JSON ou en SSE (`Accept: application/json, text/event-stream`).

## Approches considérées

| | Retenue |
|---|---|
| Widget Custom HTML dans la DA d'Escouade (A, B, C) | non : l'utilisateur préfère la DA de PhoneBox |
| Widget dans la DA de PhoneBox (D) + carte native | **oui** |
| Approbation dans le widget, par 2 raccourcis PhoneBox « Autoriser » / « Refuser » | plus tard (ci-dessous) |

## Plus tard : l'approbation dans le widget

Gardé sous le coude (maquette `docs/maquettes/Approbation.dc.html`). Le widget ne peut rien renvoyer au PC sauf
`phonebox.run(<raccourci>)`, sans paramètre. Il faudrait deux raccourcis créés à la main qui appellent le pont (par
exemple `curl -X POST 127.0.0.1:<port>/decide/allow`), le pont appliquant la décision à la demande que le widget
affiche (la plus ancienne). Risque : répondre à la mauvaise demande si une autre arrive pendant le tap ; il faudrait
que le widget n'affiche qu'une demande à la fois et que le pont refuse une décision plus vieille que le dernier push.

## À vérifier au premier essai

- Le hook `PermissionRequest` que PhoneBox installe dans `~/.claude/settings.json` capte-t-il déjà les agents
  d'Escouade (lancés avec `--permission-prompt-tool`) ? Si oui, le pont doit pouvoir couper son envoi
  (`BRIDGE_APPROVALS=0`) pour ne pas doubler les cartes.
- Rendu réel du widget sur le téléphone, et la carte native de bout en bout (`answer_permission` réel).

Réglé en lisant le code (relecture du 2026-11-22) : le widget reçoit `items.escouade.data` (PhoneBox sérialise en
camelCase, `Program.cs`) ; l'abandon de l'appel annule bien la carte (`RequestAborted` → `AskAsync` annulé). Vu sur
le vrai Escouade : les listes arrivent nues, `resetsAt` est en millisecondes, et un compteur peut porter un `model`.
