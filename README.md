# La Maja 13

Site vitrine (HTML / CSS / JS natif) + **La Casa**, l'espace membre (Express + PostgreSQL + Discord), servis par le même serveur Node.

## Développement
Prérequis : Docker Desktop.
```bash
docker compose up          # http://localhost:3000  ·  La Casa : http://localhost:3000/casa/
```
- Connexion sans Discord (bouton de connexion → compte « Dev local » avec tous les droits).
- Pages, CSS et JS : rafraîchir le navigateur suffit. Serveur (`server/src`) : `docker compose restart maja13-app`.
- Photos de la galerie écrites dans `uploads/` (ignoré par git). Base dans un volume Docker (`docker compose down -v` la remet à zéro).
- Base : après une modification de `server/prisma/schema.prisma`, `docker compose exec maja13-app npx prisma migrate dev --name <description>`, et **committer le dossier de migration créé** : c'est lui que la prod applique au démarrage.
- Tester avec le bot Discord : créer un `.env` à la racine (ignoré par git) contenant **uniquement** `BOT_API_URL`, `DISCORD_GUILD_ID` et `DEV_DISCORD_ID` (ton ID Discord, pour que le compte de dev puisse se connecter au bot), puis `docker compose up -d` — et déclarer `http://localhost:3000/casa/bot-callback.html` comme site externe du bot sur ce serveur Discord. Ne pas copier `.env.example` en dev : sa ligne `COMPOSE_FILE` désactive les réglages de dev. Attention, le bot ne garde qu'un site externe par serveur Discord : tester sur un serveur Discord de test, pas celui de la prod (voir [server/README.md](server/README.md#bot-discord)).

## Production
Déploiement pas à pas sur un VPS (Docker + nginx + HTTPS), mises à jour, sauvegardes et retour en arrière : voir [server/README.md](server/README.md).

## Organisation
- `index.html`, `accueil.html` — site vitrine (blason 3D `hero3d.js`, organigramme `org.js`, galerie `galeria.js`, `main.js`)
- `styles.css` — direction artistique (noir, bronze, or) ; `assets/` — logo, médaillon, favicon, image de partage
- `casa/` — pages de La Casa
- `server/` — serveur (`src/`), schéma et migrations de la base (`prisma/`), déploiement (`deploy/`)
- `compose.yaml` — site, base et sauvegardes (dev et prod) ; `compose.override.yaml` — réglages de dev uniquement
