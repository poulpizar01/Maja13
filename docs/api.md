# API

Deux API distinctes :
- **l'API du site** (ce dépôt) : ce que les pages appellent pour la connexion, les profils, les grades, la galerie, le chat ;
- **l'API du bot Discord Roxwood** ([roxwood-network-famille](https://github.com/poulpizar01/roxwood-network-famille)), géré à part : stocks, quotas, paies, taxes, armurerie, ventes. Le site la **relaie en lecture seule** ; le navigateur ne lui parle jamais directement.

## API du site
Toutes les réponses sont en JSON. Une requête qui modifie quelque chose (`POST`, `PATCH`, `PUT`, `DELETE`) n'est acceptée que depuis les pages du site : un en-tête `Origin` différent de `BASE_URL` reçoit `403 { error: "origine refusée" }`. Un identifiant illisible dans l'adresse (`/api/gallery/abc`) donne `404`. Authentification par **cookie de session** (`site.sid`, `HttpOnly`, `Secure` en HTTPS, 7 jours : au-delà, nouvelle connexion Discord, qui revérifie l'appartenance au serveur et le grade), posé à la connexion Discord.

### Niveaux d'accès
| Niveau | Condition | Code refusé |
|---|---|---|
| public | aucune | — |
| connecté | session ouverte (compte éventuellement en attente) | 401 |
| validé | compte **validé** : son profil seulement | 401 / 403 |
| membre | compte validé **et** rôle Discord membre (réglé dans Gestion → Hiérarchie, relu à chaque connexion), ou Gestion | 403 `member-role` |
| gestion | grade avec droits « Gestion » ou « Pouvoirs complets », ou propriétaire du serveur Discord | 403 |
| hiérarchie | grade avec « Pouvoirs complets », ou propriétaire | 403 |

Les droits se règlent par grade dans l'espace membre → Gestion → Hiérarchie, avec l'identifiant du rôle Discord membre. Rôle membre non réglé : personne ne l'a, seule la Gestion a accès au-delà du profil. Le propriétaire du serveur Discord a toujours tous les droits.

Les pages HTML de l'espace suivent les mêmes niveaux, contrôlés par le serveur avant tout envoi (`NIVEAU_PAGE`, `server/src/index.ts`) : sans droits, la page n'est pas envoyée et le serveur répond `403` avec `espace/refuse.html` (pas connecté : renvoi à la connexion ; compte en attente ou refusé : renvoi à l'attente).

Pages : **validé** — Mon profil ; **membre** — Classement, Chat, Galerie, Taxes, Armurerie ; **gestion** — Membres, Tableau de bord, Statistiques, Garage ; **hiérarchie** (pouvoirs complets) — Administration, Hiérarchie.

### Routes
| Méthode et adresse | Accès | Rôle |
|---|---|---|
| `GET /auth/discord` | public | Démarre la connexion Discord (en dev avec `DEV_LOGIN=1` : connexion directe au compte « Dev local ») |
| `GET /auth/discord/callback` | public | Retour de Discord : vérifie l'appartenance au serveur, crée ou met à jour le compte |
| `POST /auth/logout` | public | Ferme la session |
| `GET /api/me` / `PATCH /api/me` | connecté / validé | Mon compte (droits, statut) / modifier nom RP, téléphone RP, bio |
| `DELETE /api/me` | connecté | Supprimer son propre compte, validé ou non : fichiers des photos retirés du stockage d'abord, puis profil, messages et photos, puis fin de session. Stockage injoignable : `503`, rien n'est supprimé |
| `GET /api/membres` | gestion | Annuaire des membres validés (page Membres) |
| `GET /api/membres/noms` | membre | Nom RP et avatar des membres validés, par ID Discord (noms des joueurs dans le classement) |
| `GET`/`PUT /api/admin/reglages` | hiérarchie | Réglages d'accès : `memberRoleId` (rôle Discord membre, chiffres ; vide = aucun) |
| `GET /api/admin/members` · `PATCH`/`DELETE /api/admin/members/:id` | hiérarchie | Comptes (en attente, validés, refusés), sans bio ni téléphone RP : valider, refuser, changer nom RP ou grade, supprimer (pas son propre compte). Le compte du propriétaire du serveur Discord ne se modifie et ne se supprime que par lui (`403`). Suppression : `503` si le stockage des photos ne répond pas (rien n'est supprimé) |
| `GET /api/ranks` | membre | Grades complets (nom, couleur, ordre, droits, rôle Discord) |
| `POST /api/admin/ranks` · `PUT /api/admin/ranks/order` · `PATCH`/`DELETE /api/admin/ranks/:key` | hiérarchie | Créer, ordonner, modifier, supprimer des grades |
| `GET /api/org` | public | Organigramme de la vitrine (grades sans leurs droits ni rôle Discord) |
| `GET /api/admin/org` · `POST` · `PUT /api/admin/org/order` · `PATCH`/`DELETE /api/admin/org/:id` | hiérarchie | Cases de l'organigramme |
| `GET /api/gallery?limit=` | public | Photos (60 par défaut, 200 maximum), des plus récentes aux plus anciennes. Auteur : nom RP et grade ; pseudo Discord, avatar et identifiant en plus pour un compte validé avec le rôle membre (pas pour un compte en attente, refusé ou sans le rôle) |
| `POST /api/gallery` (formulaire, champ `photo` + `caption`) | membre | Publier une photo (voir [stockage.md](stockage.md)) ; `503` en production si le stockage (CDN) n'est pas configuré, ou si 3 envois sont déjà en cours sur le site (en-tête `Retry-After`) |
| `DELETE /api/gallery/:id` | membre (auteur) ou gestion | Retirer une photo |
| `GET`/`POST /api/chat/messages` · `DELETE /api/chat/messages/:id` | membre | Messages du chat (supprimer : auteur ou gestion) |
| `GET /api/chat/stream` | membre | Flux temps réel des messages (Server-Sent Events, voir [nginx.md](nginx.md)) ; 5 flux ouverts au plus par membre, le plus ancien est fermé au-delà. Un flux est fermé dès que son compte perd l'accès au chat (refus, suppression, grade ou rôle membre retiré, à la reconnexion comme après une modification dans Gestion), à la déconnexion (tous les onglets de la session), à l'échéance de la session et à l'arrêt du serveur. Avant de fermer, le serveur envoie l'événement `closed` (`"limit"`, `"access"` ou `"stop"`) : la page ne se reconnecte d'elle-même que sur `stop` |
| `GET /healthz` | public | Santé du site (serveur et base) pour le contrôle Docker : `{ ok: true }` ou `503` |
| `GET /api/chat/unread` · `POST /api/chat/read` · `GET /api/chat/mentions` | membre | Non lus, marquer comme lu, mentions `@` |
| `GET /auth/bot` · `POST /api/bot/link` · `POST /api/bot/unlink` · `GET /api/bot/status` · `GET /api/bot/data/…` | membre | Liaison et lecture du bot (ci-dessous) ; la rubrique `garages` est réservée à la Gestion et la rubrique `roles` aux pouvoirs complets, comme leurs pages |

### Limites de requêtes
| Portée | Limite |
|---|---|
| Toute l'API `/api` | 240 requêtes par minute et par membre (ou par adresse IP hors connexion) |
| Connexion `/auth` | 30 tentatives par quart d'heure et par adresse IP |
| Envoi de photos | 10 par membre toutes les 10 minutes |
| Messages du chat | 20 par minute et par membre |
| Liaison au bot (`POST /api/bot/link`) | 5 essais par membre et par quart d'heure (chaque essai est un vrai appel au bot) |
| Lectures du bot | `BOT_BUDGET` / 2 par membre et par quart d'heure (120 par défaut ; les réponses servies depuis le cache ne comptent pas). Partage entre membres : dès que le site a fait les trois quarts de `BOT_BUDGET` appels au bot dans le quart d'heure (180 par défaut), ceux qui en ont fait le quart attendent ; à `BOT_BUDGET` (240 par défaut), plus aucun appel jusqu'à la fin du quart d'heure. Le compte se recale sur celui du bot (en-têtes `RateLimit-*` de ses réponses), y compris après un redémarrage du site. Si le bot répond `429`, plus aucun appel jusqu'à l'échéance qu'il annonce |

Au-delà : `429` avec un message lisible.

**Conservation** : un message ou une photo retiré reste 7 jours en base (marqué supprimé, invisible), puis est effacé pour de bon (`server/src/purge.ts`, au démarrage puis chaque jour). Les en-têtes `RateLimit` et `RateLimit-Policy` indiquent le quota restant. Toutes les réponses de `/api` et `/auth` portent `Cache-Control: no-store` (rien de personnel gardé par le navigateur).

## API du bot Discord (relayée)
Activée par `BOT_API_URL` dans `.env` (vide : les pages liées au bot affichent « Le bot Discord n'est pas relié au site »). Code : `server/src/routes/bot.ts`.

### Liaison d'un membre au bot
Le bot n'accepte que des jetons personnels, délivrés par sa propre connexion Discord :
1. Le membre clique « Connecter mon compte au bot » → `GET /auth/bot` → redirection vers `<BOT_API_URL>/auth/login?guild=<DISCORD_GUILD_ID>`.
2. Le bot fait se connecter le membre à Discord, puis renvoie vers le **site externe déclaré** pour ce serveur Discord (`/config site-externe set url:https://<domaine>/espace/bot-callback.html`), avec le jeton dans l'adresse (`#token=…`).
3. `espace/bot-callback.html` envoie ce jeton à `POST /api/bot/link`. Le site le vérifie auprès du bot (`/api/me`) : il doit appartenir **au membre connecté** et **au serveur Discord du site**. Sinon : refus (`403`). Le jeton n'entre en session qu'une fois vérifié ; si le bot est saturé ou injoignable (`503`), celui déjà en place est gardé.
4. Le jeton est gardé dans la session du membre, jamais renvoyé au navigateur. Il vaut 7 jours ; quand le bot le refuse (`401`), le site l'oublie et le membre se reconnecte.

Un serveur Discord ne déclare **qu'un seul site externe** : tester le bot en dev se fait sur un serveur Discord de test (sinon la prod est coupée).

### Lecture relayée
`GET /api/bot/data/<rubrique>/…?…` → `GET <BOT_API_URL>/api/<rubrique>/…?…` avec le jeton du membre. Seuls les paramètres connus du bot sont transmis (`week`, `status`, `limit`, `item`, `channelId`, `type`, `q`). Rubriques autorisées : `me`, `users`, `stocks`, `quotas`, `taxes`, `armurerie`, `ventes`, `garages`, `roles` ; toute autre adresse (ou tentative de sortir de `/api/<rubrique>`) répond `404`.

| Rubrique | Adresses utilisées par les pages | Pages |
|---|---|---|
| `quotas` | `/config`, `/summary`, `/ranking`, `/pay`, `/pay/:userId`, `/:userId` (`?week=AAAA-Sss` pour une semaine passée), `/cooldowns` (un non-admin ne reçoit que les siens), `/braquages` (slots du groupe sur 7 jours glissants) | Profil, Tableau de bord, Classement, Statistiques |
| `ventes` | `/`, `/:userId` | Profil, Tableau de bord, Classement |
| `users` | `/` (un non-admin ne reçoit que lui-même) | Tableau de bord, Classement, Statistiques |
| `stocks` | `/`, `/channels`, `/:channelId`, `/history?limit=`, `/items` (catalogue : ordre, groupes, objets masqués) | Tableau de bord |
| `taxes` | `?status=active\|expired`, `/:id` (seul le détail donne téléphone et mot de passe), `/types` (libellés des types et des zones) | Taxes |
| `armurerie` | `/`, `?status=lost`, `/ammo`, `/ammo/history`, `/ammo/production`, `/types` (modèles d'armes et catégories) | Armurerie |
| `roles` | `/` (rôles du serveur Discord : `id`, `name`, `color` — relayé aux pouvoirs complets seulement) | Hiérarchie (rôle membre, rôle de chaque grade choisis par leur nom ; sans liaison au bot, identifiant à coller) |
| `garages` | `/vehicles` (véhicules sortis), `/impounds` (classement fourrière, admin du bot seulement) | Garage |

Les référentiels (`/types`, `/items`) évitent au site de recopier des listes du bot. Si le bot ne les connaît pas encore, les pages se replient sur les clés brutes mises en forme.

**Droits** : décidés par le bot à chaque requête, d'après les rôles Discord du membre. Son **rôle membre** (`/config role set membre`, « back-office web ») ouvre le back-office : stocks, quotas, ventes, taxes, armurerie, garages, rôles. Tant que ce rôle n'est pas réglé dans le bot, seuls ses admins passent. Les chiffres du groupe (classement, paie et ventes de tous) sont lisibles par tout porteur du rôle ; les données d'un joueur précis (`/:userId`), la fourrière et les coffres admin sont réservés au joueur lui-même ou aux admins du bot.

**Cache** : le bot limite chaque serveur Discord à 300 requêtes par quart d'heure (et chaque adresse IP, bien plus largement). Le site garde donc en mémoire chaque réponse réussie, sous forme de texte (sa taille réelle), par membre et par jeton : 5 minutes pour les données courantes ; pour une semaine passée (`?week=`), 24 heures s'il s'agit des données du membre lui-même, 1 heure sinon (elles ont été lues avec des droits d'admin du bot, qui peuvent être retirés). Le détail d'une taxe (téléphone, mot de passe) n'est jamais gardé. Le cache est plafonné à 48 Mo, balayé toutes les 5 minutes ; rien n'est écrit sur disque ni en base ; tout s'efface au redémarrage, quand le membre se relie au bot, ou quand ses droits d'admin du bot changent. Deux lectures identiques au même instant ne font qu'un appel.

**Charge** : les pages ne relisent le bot que toutes les 5 minutes et seulement dans un onglet visible (`espaceBot.every()`) ; les référentiels (`quotas/config`, `stocks/items`, `taxes/types`, `armurerie/types`) une fois par visite (`espaceBot.une()`) ; le contenu de chaque coffre toutes les 15 minutes ; l'historique des paies du profil à la demande. Statistiques ne se rafraîchit pas : ses lectures servent toute la visite (recharger la page pour la semaine en cours).

**Semaines** : `?week=AAAA-Www` désigne une semaine de paie du bot, du dimanche 19 h (heure de Paris) au dimanche 19 h suivant (`espaceBot.isoWeek()`).

**Réponses d'erreur** : `401 { error: "bot-unlinked" }` (pas de jeton, ou jeton expiré), `503 { error: "bot-off" }` (`BOT_API_URL` vide), `502` (le bot ne répond pas sous 15 s), `429` (quota du bot atteint, message lisible), et les codes du bot (`403` : réservé à un autre rôle).

`GET /api/bot/status` résume l'état pour l'affichage : `{ configured, linked, isAdmin }`. Seul un jeton refusé par le bot (`401`) donne `linked: false`. Si le bot ne peut pas répondre, le compte reste relié et `error` dit pourquoi : `busy` (saturé ou en erreur), `unreachable` (injoignable), `refused` (le bot refuse ce compte : plus sur le serveur Discord, ou sans le rôle requis). Les pages affichent alors un message d'attente, pas le bouton de connexion ; une erreur est retenue une minute (le bot n'est pas rappelé à chaque page vue).
