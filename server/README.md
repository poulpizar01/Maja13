# La Casa — espace membre

Express + PostgreSQL + Discord OAuth. Sert aussi le site vitrine (racine du dépôt).

## Installation sur le VPS (Docker, derrière le Caddy de Dynasty 8)
```bash
sudo git clone https://github.com/Poloveni/Maja13.git /opt/maja13
sudo bash /opt/maja13/server/deploy/vps-setup.sh      # pose les questions, écrit .env, ajoute le bloc Caddy, démarre
```
Mise à jour après un push : `sudo bash /opt/maja13/server/deploy/vps-update.sh`

## Application Discord
1. https://discord.com/developers/applications → New Application « La Maja 13 »
2. OAuth2 → copier Client ID / Client Secret dans `.env`
3. OAuth2 → Redirects → ajouter `https://<domaine>/auth/discord/callback`
4. `DISCORD_GUILD_ID` = ID du serveur (mode développeur → clic droit sur le serveur → Copier l'identifiant)
5. Grades : ils se créent et se règlent dans La Casa → Gestion → Hiérarchie (nom, ordre, couleur, droits, grade par défaut). Pour que le grade suive un rôle Discord, renseigner l'ID du rôle sur le grade concerné. `ADMIN_DISCORD_IDS` = propriétaires du site (pouvoirs complets quel que soit leur grade, indispensable pour créer les premiers grades).

## Images (galerie)
- **Dev** : sans `STORAGE_URL` / `STORAGE_TOKEN`, les photos sont écrites sur le disque (`uploads/` à la racine, ou `UPLOAD_DIR`) et servies sous `/uploads/`.
- **Prod** : avec `STORAGE_URL` et `STORAGE_TOKEN` (demandés par `vps-setup.sh`), elles partent sur le service de stockage (CDN) sous le préfixe `maja13/` (`STORAGE_PREFIX`) et la base garde leur URL publique. Les photos envoyées avant l'activation restent servies depuis le disque.

## Routes
- `GET /auth/discord` → connexion · `GET /auth/discord/callback` · `POST /auth/logout`
- `GET /api/me` · `PATCH /api/me` (displayName, phoneRp, bio) · `GET /api/familia`
- pages : `/casa/` (login), `/casa/perfil.html`, `/casa/familia.html`
