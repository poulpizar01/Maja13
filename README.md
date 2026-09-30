# La Maja 13

Site vitrine (HTML / CSS / JS natif) + **La Casa**, l'espace membre (Express + PostgreSQL + Discord), servis par le même serveur Node.

Le site est construit sur le [modèle Roxwood Network](https://github.com/poulpizar01/roxwood-network-site-famille-template) : la vitrine et la direction artistique sont propres à la Maja, **La Casa et le serveur viennent du modèle et ne se modifient pas ici** (voir [CLAUDE.md](CLAUDE.md)). Les améliorations du modèle se récupèrent avec :
```bash
git remote add modele https://github.com/poulpizar01/roxwood-network-site-famille-template.git   # une seule fois par clone
git fetch modele && git merge modele/main
```
En cas de conflit sur un fichier propre au site (`site.json`, `theme.css`, `index.html`, `accueil.html`, `styles.css`, `assets/`…), garder la version de la Maja.

## Ce qui est propre à la Maja
- `site.json` — nom, nom de l'espace membre (« La Casa »), devise, serveur, couleur d'accent (l'or), lien Discord, description ; insérés dans toutes les pages de La Casa par le serveur.
- `theme.css` — couleurs et polices (noir, bronze, or ; Pirata One, Cinzel, EB Garamond), appliquées aussi à La Casa.
- `index.html` (entrée), `accueil.html`, `styles.css` — vitrine (blason 3D `hero3d.js`, galerie en bandeau `galeria.js`) ; `assets/` — logo, médaillon, favicon, image de partage.
- `sw.js` — désinstalle l'ancien service worker de M13 OS (à supprimer à terme).

## Développement
Prérequis : Docker Desktop.
```bash
docker compose up          # http://localhost:3000  ·  La Casa : http://localhost:3000/espace/
```
- Créer un `.env` à la racine (ignoré par git) contenant au moins `SITE_ID=maja13` : sans lui, le projet Docker s'appelle `site`, comme celui du modèle, et les deux partageraient la même base.
- Connexion sans Discord (bouton de connexion → compte « Dev local » avec tous les droits).
- Pages, CSS, JS et `site.json` : rafraîchir le navigateur suffit. Serveur (`server/src`) : `docker compose restart app`.
- Tester avec le bot Discord : ajouter au `.env` **uniquement** `BOT_API_URL`, `DISCORD_GUILD_ID` et `DEV_DISCORD_ID`, et déclarer `http://localhost:3000/espace/bot-callback.html` comme site externe du bot **sur un serveur Discord de test**. Ne pas copier `.env.example` en dev (sa ligne `COMPOSE_FILE` désactive les réglages de dev).

## Production
Déploiement, mises à jour, sauvegardes et retour en arrière : [server/README.md](server/README.md) ; nginx : [docs/nginx.md](docs/nginx.md).

### Bascule depuis l'ancienne Casa (à faire une fois)
Le passage au modèle renomme les conteneurs, les volumes et l'utilisateur de la base (`maja13` → `site`), et La Casa passe de `/casa/` à `/espace/`. Les données (membres, grades, photos, chat) se reprennent telles quelles : le schéma de la base est identique. Sur le VPS, dans le dossier du site :
```bash
# 1. sauvegarde de la base actuelle (avant de mettre le code à jour)
docker exec maja13-db-1 pg_dump -U maja13 -d maja13 --clean --if-exists --no-owner > ~/maja13-avant-modele.sql
# 2. .env : ajouter SITE_ID=maja13 (garder HOST_PORT, secrets et Discord tels quels) ;
#    si les photos sont sur le stockage distant (STORAGE_URL), ajouter aussi STORAGE_PREFIX=maja13/
# 3. nouveau code, nouveaux conteneurs (les anciens sont retirés, leurs volumes gardés)
git pull && docker compose up -d --build --remove-orphans
# 4. reprise des données dans la nouvelle base
docker compose stop app
docker exec -i maja13-db psql -q -U site -d site -v ON_ERROR_STOP=1 < ~/maja13-avant-modele.sql
# 5. photos stockées sur le disque du serveur (sans STORAGE_URL) : copie vers le nouveau volume
docker run --rm -v maja13_maja13-uploads:/from -v maja13_uploads:/to alpine cp -a /from/. /to/
docker compose start app
```
Puis :
- **nginx** : rediriger les anciens liens de La Casa, dans le bloc `server` HTTPS, avant `location /` :
  `location /casa/ { rewrite ^/casa/(.*)$ /espace/$1 permanent; }`, puis `sudo nginx -t && sudo systemctl reload nginx`.
- **Bot Discord** : redéclarer le site externe (`/config site-externe set`) avec `https://lamaja13.fbfa.fr/espace/bot-callback.html` ; chaque membre reconnecte son compte au bot.
- Le cookie de session change de nom : tout le monde se reconnecte une fois. L'adresse de retour Discord (`/auth/discord/callback`) ne change pas.
- Quand tout est vérifié : `docker volume rm maja13_maja13-db maja13_maja13-uploads`. Les anciennes sauvegardes `backups/maja13-*.sql.gz` ne sont plus purgées automatiquement (les nouvelles s'appellent `site-*`) : les supprimer à la main au bout d'une semaine.
