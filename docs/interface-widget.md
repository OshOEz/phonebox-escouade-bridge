# L'interface du widget : où on en est, ce qu'on sait, des pistes

Note du 2026-11-24, pour l'agent qui retravaille l'interface du widget PhoneBox. Elle fait suite au chantier du plugin
Escouade ([spec](superpowers/specs/2026-11-24-plugin-escouade-design.md),
[plan](superpowers/plans/2026-11-24-plugin-escouade.md)). Rien ici n'est décidé : ce sont des constats et des pistes.

## À demander d'abord à l'utilisateur

**On ne sait pas encore ce qui le gêne dans l'interface actuelle.** La question lui a été posée (« depuis que tu
l'utilises, qu'est-ce qui te gêne, ou te manque, quand tu regardes le téléphone ? ») et elle est restée sans réponse :
la conversation est passée au plugin. C'est la première chose à lui demander, avant toute piste ci-dessous.

Le but de fond : la liaison avec PhoneBox doit être transparente.

Objectif suivant, déjà décidé : publier le plugin sur le store d'Escouade et le pont sur npm, **après** ce travail sur
l'interface (voir « Avant le store » en bas).

## Comment ça marche aujourd'hui

- **Le pont** ([src/main.ts](../src/main.ts)) sonde Escouade par son serveur MCP :
  - toutes les 2 s : `list_requests` ;
  - toutes les 6 s : `list_agents`, `get_usage`, `list_projects`, puis `get_agent_summary` et `list_background_work`
    agent par agent.

  Il pousse alors un instantané vers PhoneBox (`POST /api/push/escouade`, TTL 60 s).
- **L'instantané** est calculé côté pont, prêt à afficher : le widget ne contient pas de logique. Le type `Snapshot`
  est dans [src/snapshot.ts](../src/snapshot.ts) :
  - `totals` ;
  - `quotas` ;
  - `costs` ;
  - `agents[]`, avec pour chacun le statut, son libellé et sa couleur, la dernière ligne, le dernier message, le modèle,
    le ticket, le coût et les sous-agents.

  La version hors ligne porte `offline: true` et un message.
- **Plafond de taille** : PhoneBox refuse un push de plus de 65 536 octets. `snapshot.ts` réduit le contenu par paliers
  (`TIERS`, `MAX_BYTES = 60000`), et le test `staysUnderPushLimit` le garde. Toute donnée ajoutée doit tenir dans ce
  budget.
- **Le widget** ([widget/escouade.html](../widget/escouade.html)) :
  - c'est un seul fichier HTML, CSS et JS, qui reçoit `phonebox.on('push', items => items.escouade.data)` ;
  - mise en page : la liste des agents à gauche, le détail à droite ;
  - un tap sur la ligne des chiffres en haut affiche les quotas et le coût par agent.
- **Les autorisations** passent par la carte native de PhoneBox (`/api/hooks/claude/permission`), pas par le widget. La
  réponse du téléphone repart vers Escouade par `answer_permission`. Une demande restée sans réponse est reproposée une
  minute plus tard.
- **Les maquettes retenues pour la v1** sont dans [docs/maquettes/](maquettes) : `Main`, `PhoneBox`, `Approbation`,
  `ApprobationNative`.

## Nouveau depuis ce chantier : le widget se déploie tout seul

Le pont écrit lui-même la page « Escouade » de PhoneBox ([src/widget.ts](../src/widget.ts)), à chaque démarrage et quand
PhoneBox redevient joignable. Pour itérer sur l'interface :

1. modifier `widget/escouade.html` ;
2. relancer le pont : `npm start`, ou Relancer dans le Journal du plugin. Avec la commande liée, refaire d'abord
   `npm run build`, car `dist/` lit le HTML à côté de lui, sans copie ;
3. PhoneBox recharge le téléphone seul.

Le pont ne réécrit que `options.html` du premier widget `html` de la page. Taille et position restent celles que
l'utilisateur a choisies. Si l'interface veut une autre taille de grille, il faut changer `fullWidget` dans
`src/widget.ts`. Cela ne vaut que pour une page neuve.

## Les contraintes de PhoneBox (lues dans son code, `../phonebox`)

- **Bac à sable** : le widget « Custom HTML » tourne dans une iframe `srcdoc`, `sandbox="allow-scripts"`, d'origine
  opaque. Il n'a ni `src` ni accès réseau au PC (pas de jeton, et l'origine est refusée).
  - Toute donnée doit arriver par un push.
  - Côté actions, il n'y a que `phonebox.run('<id de raccourci>')` (sans paramètre) et `phonebox.goto('<page>')`.
- **Grille** : 12 × 6 par page.
- **Routes utiles côté pont, sans jeton en local** :
  - `/api/notify` : un toast avec vibration, et `page` pour changer de page ;
  - `/api/goto/<page>` ;
  - `/api/push/<clé>` : on peut pousser plusieurs clés, pour des widgets séparés.
- **Pas de système de plugins** dans PhoneBox : il est seulement prévu dans sa feuille de route.

## Pistes (à confronter à ce que dira l'utilisateur)

Classées de la moins chère à la plus chère.

1. **Attirer l'œil quand un agent attend.** `/api/notify`, avec vibration, et `/api/goto/escouade` quand un agent passe
   en `waiting` ou qu'une question arrive. C'est quelques lignes dans le pont, et c'est le cas d'usage central du
   téléphone posé sur le bureau. À régler : ne pas notifier deux fois la même demande, puisque le pont sonde déjà
   `list_requests`.
2. **Les questions des agents.** `list_requests` rend aussi les demandes de type `question` (et `plan`), mais la carte
   native de PhoneBox ne sait montrer qu'une autorisation. Le widget pourrait au moins les afficher : « X te pose une
   question », avec le texte. Y répondre depuis le widget bute sur la limite de `phonebox.run`, voir la piste 5.
3. **Les tickets à tester.** `list_tickets` ou `get_board` donnent la colonne « review ». Ce serait un compteur, ou une
   bande « À tester : ESC-12, ESC-14 ». C'est ce que l'utilisateur fait quand ses agents ont fini.
4. **Les états d'échec qui comptent.** Les agents `error` et les tours arrêtés par la limite d'usage (Escouade le dit
   dans le statut ou le résumé : à vérifier dans `get_agent_summary`) doivent ressortir autant que `waiting`.
5. **Répondre depuis le widget.** C'était gardé « pour plus tard » dans la spec v1, maquette
   `docs/maquettes/Approbation.dc.html`.
   - Il faut deux raccourcis PhoneBox, Autoriser et Refuser, qui appellent le pont : une route locale du pont, à créer.
   - Le pont applique la décision à la seule demande que le widget affiche.
   - Le risque est de répondre à la mauvaise demande. Le widget doit donc n'en afficher qu'une, et le pont doit refuser
     une décision plus vieille que son dernier push.
   - C'est la piste la plus chère : un serveur HTTP dans le pont et deux raccourcis à créer, peut-être installés comme la
     page, par `PUT /api/settings`.
6. **Plusieurs widgets plutôt qu'une page monolithique.** On pousserait des clés séparées (`escouade.waiting`,
   `escouade.quota`…) pour qu'un utilisateur pose un petit widget « agents qui attendent » sur sa page d'accueil. Le pont
   installerait alors plusieurs widgets. À ne faire que si l'utilisateur le demande.

Ce qui est hors de portée :
- parler à un agent en maintenant le doigt (l'iframe n'a pas le micro, voir la spec v1) ;
- tout ce qui demanderait que le widget joigne le PC directement.

## Ce qu'Escouade prépare de son côté

Escouade prévoit sa propre app mobile ([docs/REMOTE.md et docs/MOBILE-STUDY.md du dépôt
Escouade](../../../Escouade/docs/REMOTE.md)).
- Techno recommandée par son étude : Capacitor.
- Fonctions prévues : autorisations sous biométrie, push, QR code.
- Prérequis : l'API distante, qui n'est pas commencée.

Le widget ne doit donc pas chercher à devenir une app complète : il reste un panneau de bureau, rapide à lire.

## Avant le store (après l'interface)

Les petits défauts relevés à la revue du plugin, laissés de côté, sont à reprendre avant de publier :
- un morceau de `proc/out` qui coupe une ligne en deux donne deux lignes au Journal ([plugin/src/plugin.ts](../plugin/src/plugin.ts)) ;
- l'installation du widget n'est retentée qu'au retour des pushes, pas après un échec du GET ou du PUT pendant que les
  pushes marchent ([src/main.ts](../src/main.ts)) ;
- le Journal dit « introuvable » pour toute erreur de lancement, sans le message de l'erreur ;
- le test d'orphelin arrête `nohup npm start &` à la fermeture du terminal, et le README ne le dit pas ;
- le comportement réel en WASM (le minuteur de 10 ms, `proc/spawn` dans le PATH) n'est prouvé qu'une fois le plugin
  essayé dans le vrai Escouade.

Côté publication :
- le store doit accepter un plugin qui lance un programme installé à part (sa revue est humaine) ;
- le pont doit être publié sur npm ;
- `plugin/dist/plugin.mjs` est versionné, car Escouade ne copie pas ce qu'ignore Git.
