# La Casa — serveur et déploiement

Express + PostgreSQL + Discord OAuth. Sert aussi le site vitrine (racine du dépôt). Pour le développement, voir le [README de la racine](../README.md).

## Production
Tout tourne dans Docker, avec le même [`compose.yaml`](../compose.yaml) qu'en dev (site + base). Le site n'écoute que sur `127.0.0.1:<HOST_PORT>` ; **nginx**, sur la machine, l'expose en HTTPS.

Prérequis : Docker (avec `docker compose`), nginx, certbot (ou ta méthode HTTPS habituelle).

### Installation
```bash
git clone <url du dépôt> maja13 && cd maja13
cp .env.example .env && chmod 600 .env      # puis remplir .env (tout est expliqué dedans)
docker compose up -d --build
```
Puis nginx : copier [`deploy/nginx.conf.example`](deploy/nginx.conf.example) dans `/etc/nginx/sites-available/maja13`, remplacer `__DOMAIN__` et `__PORT__`, l'activer et recharger nginx, puis `sudo certbot --nginx -d <domaine>` pour le HTTPS.

### Au quotidien (dans le dossier du dépôt)
- Mise à jour après un push : `git pull && docker compose up -d --build`
- Changer la configuration : modifier `.env`, puis `docker compose up -d`
- Logs : `docker logs -f maja13-app-1`

Le `.env` contient `COMPOSE_FILE=compose.yaml` : les commandes ci-dessus ignorent ainsi les réglages de dev (`compose.override.yaml`).

### Bot Discord
Géré à part. La Casa n'a besoin que de trois valeurs fournies par son équipe (dans `.env`) : `BOT_DATABASE_URL` (base du bot en lecture seule), `BOT_API_URL` et `BOT_API_TOKEN` (API interne du bot). Sans elles, les pages liées au bot (tableau de bord, taxes, armurerie…) sont simplement inactives. Si le bot tourne en Docker sur la même machine, il peut rejoindre le réseau `maja13-net` pour que La Casa le joigne par nom de conteneur.

## Application Discord
1. https://discord.com/developers/applications → New Application « La Maja 13 »
2. OAuth2 → Client ID / Client Secret → `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` dans `.env`
3. OAuth2 → Redirects → ajouter `https://<domaine>/auth/discord/callback`
4. `DISCORD_GUILD_ID` = ID du serveur (mode développeur → clic droit sur le serveur → Copier l'identifiant). Seuls ses membres peuvent entrer.
5. Le **propriétaire du serveur Discord** est propriétaire du site : validé d'office, tous les droits quel que soit son grade (vérifié à chaque connexion). C'est lui qui crée les premiers grades.
6. Grades : ils se créent et se règlent dans La Casa → Gestion → Hiérarchie (nom, ordre, couleur, droits, grade par défaut). Pour que le grade suive un rôle Discord, renseigner l'ID du rôle sur le grade concerné.

## Images (galerie)
- **Dev** : les photos sont écrites dans `uploads/` à la racine du dépôt, sur le poste.
- **Prod** : avec `STORAGE_URL` et `STORAGE_TOKEN`, elles partent sur le service de stockage (CDN) sous le préfixe `maja13/` (`STORAGE_PREFIX`) et la base garde leur URL publique. Sans eux, elles restent sur le serveur (volume Docker `maja13-uploads`).

Toutes les variables : [`.env.example`](../.env.example).
