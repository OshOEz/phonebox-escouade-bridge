# Plugin Escouade et widget installé — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Escouade lance le pont par un plugin, et le pont installe lui-même la page « Escouade » de PhoneBox.

**Architecture:**
- Le pont gagne un module `src/widget.ts`, qui lit la config de PhoneBox par `GET /api/settings`, y pose la page et la
  réécrit par `PUT /api/settings`. Il gagne aussi un test de process orphelin, et une compilation esbuild en commande
  `phonebox-escouade-bridge`.
- Un plugin `run.js` dans `plugin/` (SDK `@escouade-dev/plugin`) lance cette commande, la relance, et recopie sa sortie
  au Journal.

**Tech Stack:** Node 24+ (type stripping), `node:test`, esbuild 0.25.12 (dev seulement), `@escouade-dev/plugin` ^0.5.0.

**Spec:** `docs/superpowers/specs/2026-11-24-plugin-escouade-design.md`

## Global Constraints

- Le pont n'a aucune dépendance à l'exécution ; esbuild est en `devDependencies` seulement.
- `npm start` et `npm test` restent sur les `.ts`.
- Nom de la commande : `phonebox-escouade-bridge`. Id du plugin : `io.github.oshoez.phonebox-escouade`.
- Le manifeste déclare `permissions.commands: ["phonebox-escouade-bridge"]` et `permissions.events: ["app.started"]`,
  et rien d'autre.
- La page PhoneBox a l'id `escouade`. Son widget a le type `html`, fait 12 × 6 en `x: 0, y: 0`, et porte le texte de
  `widget/escouade.html` dans `options.html`.
- Les messages pour l'utilisateur (journal, README) sont en français. Les commentaires du code suivent le style du
  dépôt : anglais, une ligne, le pourquoi.
- `plugin/dist/plugin.mjs` est versionné. Escouade, en installant depuis un dossier, ne copie pas ce qu'ignore Git.

## Review Focus

1. **PhoneBox éteint au démarrage du pont.** L'installation échoue, le pont continue, puis installe le widget quand
   PhoneBox revient. Test : `installWidget` rejette sur une connexion refusée ; dans `main.ts`, l'appel est refait au
   retour (« PhoneBox reçoit de nouveau »).
2. **L'utilisateur a modifié la page `escouade` à la main** (déplacé ou redimensionné le widget, ajouté un autre
   widget). On remplace seulement `options.html` du premier widget `html` et on ne touche ni à la position ni aux autres
   widgets. Test dans la tâche 1.
3. **Config déjà à jour.** Aucun `PUT`, pour ne pas toucher le fichier : le téléphone recharge à chaque écriture.
   Test : `withWidget` rend `null`.
4. **Conflit d'écriture (409) deux fois de suite.** Pas de boucle sans fin : un seul nouvel essai, puis une erreur.
   Test dans la tâche 1.
5. **Commande absente** (pas de `npm link`). Le plugin le dit une fois au Journal, avec quoi taper, et ne relance pas
   en boucle. Test dans la tâche 3.

---

### Task 1: Le pont installe la page « Escouade » dans PhoneBox

**Files:**
- Create: `src/widget.ts`
- Create: `test/widget.test.ts`
- Modify: `src/main.ts` (appel au démarrage et au retour de PhoneBox)

**Interfaces:**
- Consumes: `PhoneBoxConfig` de `src/phonebox.ts` (`{ url, token? }`) ; `stub()` de `test/server.ts`.
- Produces:
  - `export type Settings = { pages?: Page[]; phones?: { pages?: string[] | null }[]; [k: string]: unknown }`
  - `export function withWidget(cfg: Settings, html: string): Settings | null` : la config avec la page posée, ou
    `null` s'il n'y a rien à changer. Pure : elle ne modifie pas `cfg`.
  - `export async function installWidget(pb: PhoneBoxConfig, html: string): Promise<'installé' | 'à jour'>`
  - `export const WIDGET_HTML: URL` : `new URL('../widget/escouade.html', import.meta.url)`. Le chemin vaut depuis
    `src/` comme depuis `dist/`.

- [ ] **Step 1: Write the failing tests** in `test/widget.test.ts`

  Pour `withWidget` :
  - `creates the page when missing` : à partir de `{ pages: [{ id: 'home', widgets: [] }], theme: 'x' }`, on obtient
    `pages[1]` qui vaut
    `{ id: 'escouade', title: 'Escouade', icon: '🛰️', enabled: true, widgets: [{ id: 'escouade-html', type: 'html', x: 0, y: 0, w: 12, h: 6, options: { html: H, transparent: true } }] }`.
    `pages[0]` et `theme` restent intacts.
  - `replaces only the html of an existing page` : la page `escouade` a un widget `html` en `x: 2, w: 6` avec
    `options: { html: 'old', transparent: false }`, plus un widget `note`. On obtient le même tableau, sauf
    `options.html === H`. La position, `transparent` et le widget `note` restent intacts.
  - `adds an html widget to an existing page that has none` : on obtient un widget 12 × 6 ajouté.
  - `returns null when nothing changes` : la page est présente avec `html === H`, et `phones` vaut
    `[{ pages: [] }, { pages: null }]`.
  - `adds the page to a phone that lists its pages` : `phones: [{ pages: ['home'] }]` devient `['home', 'escouade']`.
  - `does not mutate its input` : un `structuredClone` de l'entrée est égal à l'entrée après l'appel.

  Pour `installWidget`, avec `stub()` :
  - `GET then PUT with the version` : le stub répond au GET avec l'en-tête `X-Config-Version: 42` et
    `{ pages: [] }`. On vérifie que le PUT reçoit `X-Config-Version: 42`, le type `application/json` et un corps qui
    contient la page, et que le résultat vaut `'installé'`.
  - `does not PUT when up to date` : aucun PUT reçu, résultat `'à jour'`.
  - `retries once on 409` : premier PUT en 409, second GET en version 43, second PUT en 200. On a deux GET et deux
    PUT, et le second PUT porte `43`.
  - `gives up after a second 409` : rejet avec un message qui contient `409`, après exactement deux PUT.
  - `rejects when PhoneBox is down` : l'URL `http://127.0.0.1:1` rejette.

- [ ] **Step 2: Run them to verify they fail**

  Run: `node --test test/widget.test.ts`
  Expected: FAIL, `Cannot find module '../src/widget.ts'`

- [ ] **Step 3: Implement `withWidget` and `installWidget` in `src/widget.ts`**

  - Comparer les `options.html` avant d'écrire. `installWidget` fait `get` → `withWidget` → `put` dans une boucle de
    deux tours au plus. Seul un 409 relance le tour.
  - Les en-têtes reprennent ceux de `phonebox.ts`. Exporter `headers` de `src/phonebox.ts` plutôt que le recopier.
  - Mettre un délai de 10 s par appel (`AbortSignal.timeout(10_000)`), comme les appels à Escouade.

- [ ] **Step 4: Run the tests**

  Run: `node --test`
  Expected: tout PASS (les anciens tests compris)

- [ ] **Step 5: Wire it in `src/main.ts`**

  - Ajouter `async function ensureWidget()`. Elle lit `WIDGET_HTML` avec `readFile`, appelle `installWidget(phonebox, html)`,
    puis écrit dans le journal `Page Escouade installée dans PhoneBox` pour `'installé'`, et rien pour `'à jour'`.
  - Sur une erreur, elle écrit `PhoneBox : page Escouade non installée : <message>` et ne relance pas l'erreur.
  - L'appeler une fois avant la boucle, et dans `sendIfChanged` là où s'écrit `PhoneBox reçoit de nouveau`.
  - Contrôle à la main, si PhoneBox tourne : `npm start`. Le journal dit `Page Escouade installée dans PhoneBox`, puis
    rien de plus au redémarrage suivant.

- [ ] **Step 6: Commit**

  ```bash
  git add src/widget.ts src/phonebox.ts src/main.ts test/widget.test.ts
  git commit -m "feat: le pont installe la page Escouade dans PhoneBox"
  ```

### Task 2: Le pont devient la commande `phonebox-escouade-bridge`

**Files:**
- Modify: `package.json`, `.gitignore`, `src/main.ts`, `README.md`

**Interfaces:**
- Produces: la commande `phonebox-escouade-bridge`, sans argument, que la tâche 3 lance.

- [ ] **Step 1: Orphan check in `src/main.ts`**

  Garder `const parent = process.ppid` au démarrage. Au début de `tick()`, si `process.ppid !== parent`, écrire
  `Escouade n'est plus là : arrêt du pont`, puis appeler `relay.sync([])` et `process.exit(0)`.
  Ce chemin n'a pas de test unitaire : on le contrôle à l'étape 4.

- [ ] **Step 2: Build and bin in `package.json`**

  - `"bin": { "phonebox-escouade-bridge": "dist/bridge.mjs" }`
  - `"files": ["dist", "widget"]`
  - `"scripts.build"` :
    `esbuild src/main.ts --bundle --platform=node --format=esm --target=node24 --outfile=dist/bridge.mjs --banner:js='#!/usr/bin/env node'`
  - `"devDependencies": { "esbuild": "0.25.12" }`
  - Ajouter `dist/` et `node_modules/` à `.gitignore`. Mettre `package-lock.json` sous Git.

- [ ] **Step 3: Build and link**

  Run: `npm install && npm run build && npm link && command -v phonebox-escouade-bridge`
  Expected: un chemin vers la commande. `head -1 dist/bridge.mjs` affiche `#!/usr/bin/env node`.

- [ ] **Step 4: Smoke test of the command and of the orphan check**

  - Run: `sh -c 'phonebox-escouade-bridge & sleep 3; kill -9 $$' ; sleep 4; pgrep -f phonebox-escouade-bridge || echo arrêté`
    Expected: `arrêté`. Le shell parent meurt, donc le pont s'arrête au tour suivant (2 s).
  - Si PhoneBox tourne, la première ligne du pont montre en plus que `widget/escouade.html` est bien trouvé depuis
    `dist/`.

- [ ] **Step 5: README**

  Remplacer l'étape « Run the bridge » et l'étape 5 (copier-coller du widget) :
  - `npm install && npm run build && npm link`, puis l'installation du plugin (renvoi à la tâche 3) ;
  - `npm start` reste possible sans Escouade ;
  - le widget s'installe tout seul sur une page « Escouade » ; si ton téléphone ne montre que certaines pages, le pont
    l'y ajoute.

- [ ] **Step 6: Run the tests and commit**

  Run: `npm test`, Expected: PASS
  ```bash
  git add package.json package-lock.json .gitignore src/main.ts README.md
  git commit -m "feat: le pont en commande phonebox-escouade-bridge, arrêté s'il perd Escouade"
  ```

### Task 3: Le plugin Escouade

**Files:**
- Create: `plugin/package.json`, `plugin/escouade-plugin.json`, `plugin/src/plugin.ts`, `plugin/src/main.ts`,
  `plugin/test/plugin.test.ts`, `plugin/.gitignore` (`node_modules/`), `plugin/dist/plugin.mjs` (compilé, versionné)
- Modify: `README.md` (installation du plugin)

**Interfaces:**
- Consumes: la commande `phonebox-escouade-bridge` (tâche 2) ; `createPlugin`, `Plugin` de `@escouade-dev/plugin` ;
  `connect`, `FakeEscouade` de `@escouade-dev/plugin/testing`.
- Produces:
  - `export function bridgePlugin(opts?: { restartMs?: number }): Plugin`, dans `plugin/src/plugin.ts` ;
    `restartMs` vaut 5000 par défaut.
  - `plugin/src/main.ts` : `void bridgePlugin().start();`

Comportement, que les tests fixent :
- **`onInitialize`** : programmer le lancement par `setTimeout(launch, 0)`. Il ne faut pas appeler Escouade avant la
  réponse à `initialize`. Le lancement a lieu ici, et pas sur `app.started` : le bouton Relancer du Journal redémarre
  l'instance sans renvoyer `app.started`. On enregistre quand même un gestionnaire vide sur `app.started`, pour que ce
  fait active l'instance.
- **`launch`** : `runProgram({ command: 'phonebox-escouade-bridge', args: [] }, onOut)`, puis journal `Pont lancé`.
  - `onOut` découpe en lignes et ignore les vides. Une ligne de `stdout` va en `log.info`, une de `stderr` en
    `log.warn`.
  - À la sortie du pont, s'il n'y a pas d'arrêt en cours : `log.warn('Pont arrêté (code X), relance dans 5 s')`, puis
    relance après `restartMs`.
  - Si `runProgram` rejette : `log.error('Commande phonebox-escouade-bridge introuvable : dans le dossier du pont, lance npm run build puis npm link, puis Relancer ici.')`, sans relance.
- **`onShutdown`** : marquer l'arrêt, annuler la relance prévue et `kill()` le pont.

- [ ] **Step 1: Scaffold `plugin/`**

  - `package.json`, sur le modèle de `Escouade/plugins/team-rules/package.json` :
    - `name: "phonebox-escouade-plugin"`, `private`, `type: module` ;
    - scripts `build` (esbuild `src/main.ts` → `dist/plugin.mjs`, `--bundle --platform=node --format=esm --target=node20`)
      et `test` (`node --test test/*.test.ts`) ;
    - devDeps `@escouade-dev/plugin` `^0.5.0` et `esbuild` `0.25.12`.
  - `escouade-plugin.json` :
    - `$schema`, `id`, `name: "PhoneBox"` ;
    - `version: "0.1.0"`, `description` fr et en, `author`, `license: "MIT"`, `escouade: { api: "1", min: "2.2.0" }` ;
    - `run: { js: "dist/plugin.mjs" }`, `activation: ["event:app.started"]` ;
    - les permissions des contraintes globales.
  - Run: `cd plugin && npm install`. Expected: OK.

- [ ] **Step 2: Write the failing tests** in `plugin/test/plugin.test.ts`

  Le faux Escouade se crée par `connect(bridgePlugin({ restartMs: 10 }), { host: { 'proc/spawn': …, 'proc/kill': … } })`.
  On lit le journal dans `fake.logs`.
  - `launches the bridge after initialize` : un seul `proc/spawn`, avec `{ command: 'phonebox-escouade-bridge', args: [] }`,
    et la ligne `Pont lancé` au journal.
  - `copies the bridge's lines to the journal` : `proc/out` stdout `'a\n\nb\n'` donne deux lignes `info` (`a`, `b`).
    `proc/out` stderr `'x\n'` donne une ligne `warn`.
  - `restarts after an exit` : `proc/exit` code 1 donne une ligne `warn` qui contient `code 1`, puis, après 20 ms, un
    second `proc/spawn`.
  - `says how to install when the command is missing` : `proc/spawn` lève une erreur. On attend une ligne `error` qui
    contient `npm link`, et aucun second spawn après 50 ms.
  - `kills the bridge on shutdown and does not restart` : `fake.shutdown()` appelle `proc/kill` avec `{ proc }`. Un
    `proc/exit` qui suit ne relance rien.

- [ ] **Step 3: Run them to verify they fail**

  Run: `cd plugin && npm test`
  Expected: FAIL, `Cannot find module '../src/plugin.ts'`

- [ ] **Step 4: Implement `bridgePlugin` in `plugin/src/plugin.ts` and `plugin/src/main.ts`**

- [ ] **Step 5: Run the tests**

  Run: `cd plugin && npm test`
  Expected: PASS

- [ ] **Step 6: Build and check the manifest**

  Run: `cd plugin && npm run build && npx escouade-plugin validate .`
  Expected: `dist/plugin.mjs` est écrit et le manifeste est valide. Si la CLI n'est pas dans le SDK, on vérifie le
  manifeste à l'essai réel de l'étape 7.

- [ ] **Step 7: Essai réel**, avec l'utilisateur, qui a Escouade ouverte

  1. Dans Escouade : vue Plugins › En développement › Charger un dossier…, sur `plugin/`.
  2. Accepter l'installation. La fenêtre doit montrer la seule commande `phonebox-escouade-bridge`.
  3. Dans l'onglet Journal : `Pont lancé`, puis les lignes du pont (`Escouade … → PhoneBox …`).
  4. Quitter Escouade. Run: `pgrep -f phonebox-escouade-bridge || echo arrêté`. Expected: `arrêté`.

- [ ] **Step 8: README and commit**

  - README : la section « Installer le plugin » (les deux gestes) et ce que montre le Journal.
  ```bash
  git add plugin README.md
  git commit -m "feat: plugin Escouade qui lance le pont et montre son état"
  ```
