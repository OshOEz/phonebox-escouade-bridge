# Le pont lancé par Escouade, et le widget installé par le pont

Design du 2026-11-24. Suite de [la v1](2026-11-22-pont-v1-design.md).

## Pourquoi

Rendre la liaison avec PhoneBox transparente : plus de `npm start` à lancer, plus de HTML à copier-coller dans PhoneBox.
L'interface du widget viendra ensuite, dans un autre chantier.

## Objectifs

1. Un plugin Escouade lance le pont au démarrage d'Escouade, le relance s'il meurt, et il meurt quand on quitte
   Escouade.
2. L'état du pont se lit dans Escouade.
3. Le pont crée ou met à jour lui-même la page « Escouade » de PhoneBox.

## Hors périmètre

- Publier le plugin sur le store : il refuse un plugin qui lance `node`. Installation depuis un dossier, « non vérifié ».
- Un vrai plugin WASM sans le pont : le bac à sable d'Escouade interdit le réseau local, ne laisse que 500 ms pour
  répondre à une autorisation et ne donne pas le quota (vérifié dans le code d'Escouade, 2026-11-24).
- Les réglages de PhoneBox (URL, jeton) dans le plugin : les valeurs par défaut du pont marchent en local, où PhoneBox
  ne demande pas de jeton. Les variables d'environnement restent possibles pour `npm start`.
- Retoucher l'interface du widget.

## Approches retenues (choix du 2026-11-24)

| Question | Retenu | Écarté |
|---|---|---|
| Comment le plugin trouve le pont | `npm run plugin` écrit le manifeste avec le chemin exact de `src/main.ts` : l'installation montre la commande précise | `node *` et le chemin dans un réglage : la fenêtre d'installation dirait « lance node avec n'importe quoi » |
| Où voir l'état | L'onglet Journal de la page du plugin (« En marche », Relancer, et nos lignes) : le seul endroit servi | Barre d'état, badges : réservés, pas servis par Escouade |
| Le widget | Le pont l'installe à chaque démarrage, par `GET`/`PUT /api/settings` de PhoneBox | Une commande `npm run install-widget` à relancer à chaque version |
| Escouade plante | Le pont s'arrête seul quand son process parent change | Le laisser orphelin |

## Ce que ça donne

### Le plugin (`plugin/`, dans ce dépôt)

- TypeScript avec le SDK `@escouade-dev/plugin`, compilé par esbuild vers `plugin/dist/plugin.mjs` (comme
  `plugins/team-rules` d'Escouade). L'app le compile elle-même en WASM.
- Manifeste écrit par `npm run plugin` (non versionné) :
  - id `io.github.oshoez.phonebox-escouade` ;
  - activé par `event:app.started` ;
  - `permissions.commands: ["node <chemin absolu>/src/main.ts"]`. Si le chemin contient un espace, le script refuse
    et le dit : Escouade découpe la commande aux espaces.
- Au démarrage : il lance `node <chemin>/src/main.ts`.
  - Chaque ligne que le pont écrit va au Journal : info pour la sortie standard, avertissement pour les erreurs.
  - Le plugin y ajoute « pont lancé », et « pont arrêté (code X), relance dans 5 s ».
- À la fermeture (`onShutdown`) : il tue le pont. Escouade tue de toute façon le groupe de process par SIGKILL.
  Effets constatés à la lecture du code : la coupure de la requête retire la carte d'autorisation en cours du
  téléphone, et les agents s'effacent seuls au bout de 60 s (TTL déjà en place).
- Installation : vue Plugins › En développement › Charger un dossier…, sur `plugin/`. Le mode d'emploi passe dans le
  README.

### Le pont

- **Widget** : au démarrage, puis à chaque fois que PhoneBox redevient joignable.
  1. `GET /api/settings`, en gardant `X-Config-Version`.
  2. Chercher la page d'id `escouade`.
     - Absente : la créer, avec un widget `html` qui prend toute la grille (12 × 6) et le contenu de
       `widget/escouade.html`.
     - Présente : remplacer `options.html` de son widget `html` seulement si le texte a changé. Sinon, ne rien écrire.
  3. Si un téléphone liste ses pages (`phones[].pages` non vide) sans `escouade`, l'y ajouter. Sinon la page ne
     s'affiche pas.
  4. `PUT /api/settings` avec `X-Config-Version`. Sur 409, relire et réessayer une fois.
  5. Un échec s'écrit dans le journal du pont et ne l'arrête pas.

  PhoneBox garde un `.bak` et le téléphone recharge seul.
- **Orphelin** : à chaque tour, si `process.ppid` n'est plus celui du démarrage, le pont s'arrête.

## Laissé au constructeur

- La forme exacte des lignes du Journal.
- Le découpage du code de l'installation du widget (un module `src/widget.ts` avec ses tests, à la manière des autres).

## Risques

- Le `PUT` remplace toute la configuration de PhoneBox. On part toujours d'un `GET` frais, et le contrôle de version
  évite d'écraser une modification faite entre-temps.
- Non vérifié : que l'événement `app.started` arrive bien au plugin au premier démarrage. Repli : le bouton Démarrer
  du Journal.
