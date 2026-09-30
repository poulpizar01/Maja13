# API

Deux API distinctes :
- **l'API du site** (ce dépôt) : ce que les pages appellent pour la connexion, les profils, les grades, la galerie, le chat ;
- **l'API du bot Discord Roxwood** ([roxwood-network-famille](https://github.com/poulpizar01/roxwood-network-famille)), géré à part : stocks, quotas, paies, taxes, armurerie, ventes. Le site la **relaie en lecture seule** ; le navigateur ne lui parle jamais directement.

## API du site
Toutes les réponses sont en JSON. Authentification par **cookie de session** (`site.sid`, `HttpOnly`, `Secure` en HTTPS, 30 jours), posé à la connexion Discord.

### Niveaux d'accès
| Niveau | Condition | Code refusé |
|---|---|---|
| public | aucune | — |
| connecté | session ouverte (compte éventuellement en attente) | 401 |
| membre | compte **validé** | 401 / 403 |
| gestion | grade avec droits « Gestion » ou « Pouvoirs complets », ou propriétaire du serveur Discord | 403 |
| hiérarchie | grade avec « Pouvoirs complets », ou propriétaire | 403 |

Les droits se règlent par grade dans l'espace membre → Gestion → Hiérarchie. Le propriétaire du serveur Discord a toujours tous les droits.

### Routes
| Méthode et adresse | Accès | Rôle |
|---|---|---|
| `GET /auth/discord` | public | Démarre la connexion Discord (en dev avec `DEV_LOGIN=1` : connexion directe au compte « Dev local ») |
| `GET /auth/discord/callback` | public | Retour de Discord : vérifie l'appartenance au serveur, crée ou met à jour le compte |
| `POST /auth/logout` | public | Ferme la session |
| `GET /api/me` / `PATCH /api/me` | connecté / membre | Mon compte (droits, statut) / modifier nom RP, téléphone RP, bio |
| `GET /api/membres` | membre | Membres validés |
| `GET /api/admin/members` · `PATCH`/`DELETE /api/admin/members/:id` | gestion | Comptes (en attente, validés, refusés) : valider, refuser, changer nom RP ou grade |
| `GET /api/ranks` | public | Grades (nom, couleur, ordre) |
| `POST /api/admin/ranks` · `PUT /api/admin/ranks/order` · `PATCH`/`DELETE /api/admin/ranks/:key` | hiérarchie | Créer, ordonner, modifier, supprimer des grades |
| `GET /api/org` | public | Organigramme de la vitrine |
| `GET /api/admin/org` · `POST` · `PUT /api/admin/org/order` · `PATCH`/`DELETE /api/admin/org/:id` | hiérarchie | Cases de l'organigramme |
| `GET /api/gallery?limit=` | public | Photos (60 par défaut, 200 maximum), des plus récentes aux plus anciennes |
| `POST /api/gallery` (formulaire, champ `photo` + `caption`) | membre | Publier une photo (voir [stockage.md](stockage.md)) |
| `DELETE /api/gallery/:id` | membre (auteur) ou gestion | Retirer une photo |
| `GET`/`POST /api/chat/messages` · `DELETE /api/chat/messages/:id` | membre | Messages du chat (supprimer : auteur ou gestion) |
| `GET /api/chat/stream` | membre | Flux temps réel des messages (Server-Sent Events, voir [nginx.md](nginx.md)) |
| `GET /api/chat/unread` · `POST /api/chat/read` · `GET /api/chat/mentions` | membre | Non lus, marquer comme lu, mentions `@` |
| `GET /auth/bot` · `POST /api/bot/link` · `POST /api/bot/unlink` · `GET /api/bot/status` · `GET /api/bot/data/…` | membre | Liaison et lecture du bot (ci-dessous) |

### Limites de requêtes
| Portée | Limite |
|---|---|
| Toute l'API `/api` | 240 requêtes par minute et par membre (ou par adresse IP hors connexion) |
| Connexion `/auth` | 30 tentatives par quart d'heure et par adresse IP |
| Envoi de photos | 10 par membre toutes les 10 minutes |
| Messages du chat | 20 par minute et par membre |
| Lectures du bot | 150 par membre et par quart d'heure (les réponses servies depuis le cache ne comptent pas) |

Au-delà : `429` avec un message lisible. Les en-têtes `RateLimit` et `RateLimit-Policy` indiquent le quota restant.

## API du bot Discord (relayée)
Activée par `BOT_API_URL` dans `.env` (vide : les pages liées au bot affichent « Le bot Discord n'est pas relié au site »). Code : `server/src/routes/bot.ts`.

### Liaison d'un membre au bot
Le bot n'accepte que des jetons personnels, délivrés par sa propre connexion Discord :
1. Le membre clique « Connecter mon compte au bot » → `GET /auth/bot` → redirection vers `<BOT_API_URL>/auth/login?guild=<DISCORD_GUILD_ID>`.
2. Le bot fait se connecter le membre à Discord, puis renvoie vers le **site externe déclaré** pour ce serveur Discord (`/config site-externe set url:https://<domaine>/espace/bot-callback.html`), avec le jeton dans l'adresse (`#token=…`).
3. `espace/bot-callback.html` envoie ce jeton à `POST /api/bot/link`. Le site le vérifie auprès du bot (`/api/me`) : il doit appartenir **au membre connecté** et **au serveur Discord du site**. Sinon : refus (`403`).
4. Le jeton est gardé dans la session du membre, jamais renvoyé au navigateur. Il vaut 7 jours ; quand le bot le refuse (`401`), le site l'oublie et le membre se reconnecte.

Un serveur Discord ne déclare **qu'un seul site externe** : tester le bot en dev se fait sur un serveur Discord de test (sinon la prod est coupée).

### Lecture relayée
`GET /api/bot/data/<rubrique>/…?…` → `GET <BOT_API_URL>/api/<rubrique>/…?…` avec le jeton du membre. Rubriques autorisées : `me`, `users`, `stocks`, `quotas`, `taxes`, `armurerie`, `ventes` ; toute autre adresse (ou tentative de sortir de `/api/<rubrique>`) répond `404`.

| Rubrique | Adresses utilisées par les pages | Pages |
|---|---|---|
| `quotas` | `/config`, `/summary`, `/ranking`, `/pay`, `/pay/:userId`, `/:userId` (`?week=AAAA-Sss` pour une semaine passée) | Profil, Tableau de bord, Classement, Statistiques |
| `ventes` | `/`, `/:userId` | Profil, Tableau de bord, Classement |
| `users` | `/` (un non-admin ne reçoit que lui-même) | Tableau de bord, Classement, Statistiques |
| `stocks` | `/`, `/channels`, `/:channelId`, `/history?limit=` | Tableau de bord |
| `taxes` | `?status=active\|expired`, `/:id` (seul le détail donne téléphone et mot de passe) | Taxes |
| `armurerie` | `/`, `?status=lost`, `/ammo`, `/ammo/history` | Armurerie |

**Droits** : décidés par le bot à chaque requête, d'après les rôles Discord du membre (admin ou non). Un membre non admin ne lit que ses propres données (quotas, paie, ventes) et ne voit pas les coffres admin.

**Cache** : le bot limite **tout le site** à 300 requêtes par quart d'heure. Le site garde donc en mémoire chaque réponse réussie, par membre : 5 minutes pour les données courantes, 24 heures pour une semaine passée (`?week=`). Rien n'est écrit sur disque ni en base ; tout s'efface au redémarrage ou quand le membre se relie au bot.

**Réponses d'erreur** : `401 { error: "bot-unlinked" }` (pas de jeton, ou jeton expiré), `503 { error: "bot-off" }` (`BOT_API_URL` vide), `502` (le bot ne répond pas sous 15 s), et les codes du bot (`403` : réservé à un autre rôle).

`GET /api/bot/status` résume l'état pour l'affichage : `{ configured, linked, isAdmin }`.
