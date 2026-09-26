# La Casa — serveur et déploiement

Express + PostgreSQL + Discord OAuth. Sert aussi le site vitrine (racine du dépôt). Pour le développement, voir le [README de la racine](../README.md).

## Production
Tout tourne dans Docker, avec le même [`compose.yaml`](../compose.yaml) qu'en dev (site + base ; en prod sans `compose.override.yaml`). Le site n'écoute que sur `127.0.0.1:<HOST_PORT>` ; **nginx**, sur la machine, l'expose en HTTPS.

Prérequis : Docker (avec `docker compose`), nginx, certbot (ou ta méthode HTTPS habituelle).

```bash
sudo git clone <url du dépôt> <dossier>
sudo bash <dossier>/server/deploy/vps-setup.sh     # questions → server/.env, site nginx, construction et démarrage
sudo certbot --nginx -d <domaine>                   # HTTPS (une fois)
```
- Mise à jour après un push : `sudo bash <dossier>/server/deploy/vps-update.sh`
- Reconfigurer (domaine, port, Discord, stockage) : relancer `vps-setup.sh` (les secrets existants sont conservés)
- Logs : `sudo docker logs -f maja13-app-1`

### Scripts (`deploy/`)
| Fichier | Rôle |
|---|---|
| `vps-setup.sh` | installation / reconfiguration du site |
| `vps-update.sh` | mise à jour après un push |
| `lib.sh` | chemins et commandes communs aux deux scripts |
| `nginx.conf.template` | modèle du site nginx, rempli par `vps-setup.sh` |

### Bot Discord
Géré à part. La Casa n'a besoin que de trois valeurs fournies par son équipe (demandées par `vps-setup.sh`) : `BOT_DATABASE_URL` (base du bot en lecture seule), `BOT_API_URL` et `BOT_API_TOKEN` (API interne du bot). Sans elles, les pages liées au bot (tableau de bord, taxes, armurerie…) sont simplement inactives. Si le bot tourne en Docker sur la même machine, il peut rejoindre le réseau `maja13-net` pour que La Casa le joigne par nom de conteneur.

## Application Discord
1. https://discord.com/developers/applications → New Application « La Maja 13 »
2. OAuth2 → Client ID / Client Secret (demandés par `vps-setup.sh`)
3. OAuth2 → Redirects → ajouter `https://<domaine>/auth/discord/callback`
4. `DISCORD_GUILD_ID` = ID du serveur (mode développeur → clic droit sur le serveur → Copier l'identifiant)
5. Grades : ils se créent et se règlent dans La Casa → Gestion → Hiérarchie (nom, ordre, couleur, droits, grade par défaut). Pour que le grade suive un rôle Discord, renseigner l'ID du rôle sur le grade concerné. `ADMIN_DISCORD_IDS` = propriétaires du site (pouvoirs complets quel que soit leur grade, indispensable pour créer les premiers grades).

## Images (galerie)
- **Dev** : sans `STORAGE_URL` / `STORAGE_TOKEN`, les photos sont écrites sur le disque (`uploads/` à la racine, ou `UPLOAD_DIR`) et servies sous `/uploads/`.
- **Prod** : avec `STORAGE_URL` et `STORAGE_TOKEN` (demandés par `vps-setup.sh`), elles partent sur le service de stockage (CDN) sous le préfixe `maja13/` (`STORAGE_PREFIX`) et la base garde leur URL publique. Sans eux, elles restent sur le serveur (volume Docker `maja13-uploads`).

Toutes les variables : [`.env.example`](.env.example).
