# Serveur et déploiement

Express + PostgreSQL + Discord OAuth. Sert aussi le site vitrine (racine du dépôt). Pour créer un site à partir du modèle et pour le développement, voir le [README de la racine](../README.md).

Documentation détaillée : [nginx](../docs/nginx.md) · [stockage des photos (CDN)](../docs/stockage.md) · [API du site et du bot](../docs/api.md).

## Production
Tout tourne dans Docker, avec le même [`compose.yaml`](../compose.yaml) qu'en dev (site + base + sauvegardes). Le site n'écoute que sur `127.0.0.1:<HOST_PORT>` ; **nginx**, sur la machine, l'expose en HTTPS.

Les commandes ci-dessous visent un VPS Debian / Ubuntu, avec un utilisateur qui a `sudo`. `<depot>` est l'adresse du dépôt **du site** (pas celle du modèle), `<SITE_ID>` l'identifiant choisi dans `.env`.

### 1. Avant de commencer
- **Domaine** : un enregistrement DNS `A` (et `AAAA` si le VPS a une IPv6) du domaine vers l'IP du VPS. Vérifier avec `dig +short <domaine>` : certbot échoue tant que le domaine ne pointe pas sur la machine.
- **Application Discord** : créée et configurée (voir [Application Discord](#application-discord)), avec la redirection `https://<domaine>/auth/discord/callback`.
- **Bot Discord** (facultatif) : l'URL publique HTTPS de son API.

### 2. Préparer le VPS (une seule fois par machine)
```bash
# Docker (script officiel : Docker Engine + docker compose), démarré avec la machine
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER            # puis se déconnecter / reconnecter pour utiliser docker sans sudo
# nginx, certbot, git
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx git
# pare-feu : SSH + web (si ufw est utilisé ; sinon, ouvrir 80 et 443 dans le pare-feu de l'hébergeur)
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```

### 3. Installer le site
```bash
git clone -b main <depot> <SITE_ID> && cd <SITE_ID>
cp .env.example .env && chmod 600 .env
nano .env                                   # remplir : tout est expliqué dans le fichier
docker compose up -d --build
```
- Le serveur suit la branche `main` : c'est elle qui est déployée.
- `SITE_ID` et `HOST_PORT` doivent être **uniques sur la machine** : chaque site a ses propres conteneurs (`<SITE_ID>-app`, `<SITE_ID>-db`, `<SITE_ID>-backup`) et son propre port. `ss -ltnp` liste les ports déjà pris (autres sites, API du bot…).
- Générer `SESSION_SECRET` et `POSTGRES_PASSWORD` avec `openssl rand -hex 32` (le mot de passe de la base ne se change plus une fois la base créée).

Vérifier : `docker compose ps` (les trois services `Up`, la base `healthy`) et `docker logs <SITE_ID>-app`, qui doit finir par `<nom du site> en écoute sur le port 3000 (https://<domaine>)`. Le premier démarrage crée les tables (migrations Prisma).

### 4. nginx et HTTPS
```bash
sudo cp server/deploy/nginx.conf.example /etc/nginx/sites-available/<SITE_ID>
sudo nano /etc/nginx/sites-available/<SITE_ID>          # remplacer __DOMAIN__ et __PORT__ (= HOST_PORT)
sudo ln -s /etc/nginx/sites-available/<SITE_ID> /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d <domaine>                      # certificat + redirection http → https, renouvelé automatiquement
```
**Ne pas tester la connexion avant certbot** : avec `BASE_URL` en `https://`, le cookie de session n'est envoyé qu'en HTTPS, la connexion Discord échoue donc en `http://`. Rôle de chaque réglage nginx, plusieurs sites, dépannage : [docs/nginx.md](../docs/nginx.md).

### 5. Première connexion
La base de prod démarre **vide** (rien n'est repris du dev). Le **propriétaire du serveur Discord** se connecte le premier : il est validé d'office avec tous les droits et crée les grades dans l'espace membre → Gestion → Hiérarchie. Les autres membres qui se connectent attendent ensuite sa validation.

Puis, si le bot est utilisé : voir [Bot Discord](#bot-discord).

Le domaine n'est écrit nulle part dans les fichiers : `robots.txt`, `sitemap.xml` et les aperçus de partage le prennent dans `BASE_URL`.

### Au quotidien (dans le dossier du site)
- Mise à jour après un push sur `main` : `git pull && docker compose up -d --build` (les nouvelles migrations sont appliquées au démarrage), puis `docker image prune -f` pour effacer les anciennes images.
- Changer la configuration : modifier `.env`, puis `docker compose up -d`
- Logs : `docker logs -f <SITE_ID>-app` (limités à 3 × 10 Mo par service, voir `compose.yaml`)
- Mémoire et processeur : chaque conteneur a un plafond (site 512 Mo et 1 processeur, base 256 Mo et 1 processeur, sauvegardes 128 Mo). `docker stats` montre la consommation réelle ; pour les ajuster, décommenter `APP_MEMORY`, `DB_MEMORY`… dans `.env`, puis `docker compose up -d`.
- État : `docker compose ps`

Le `.env` contient `COMPOSE_FILE=compose.yaml` : les commandes ci-dessus ignorent ainsi les réglages de dev (`compose.override.yaml`).

### Revenir en arrière après une mise à jour ratée
Les migrations de la base ne s'annulent pas : revenir à un ancien commit ne suffit pas si la mise à jour en contenait une.
1. Revenir au code précédent : `git log --oneline`, puis `git checkout <commit>` et `docker compose up -d --build`.
2. Si la mise à jour contenait une migration (`server/prisma/migrations/`) : restaurer la dernière sauvegarde **antérieure** à la mise à jour (voir ci-dessous). Les écritures faites entre-temps sont perdues.
3. Une fois le problème corrigé sur `main` : `git checkout main && git pull && docker compose up -d --build`.

Faire une sauvegarde juste avant une mise à jour qui touche la base : `docker compose restart backup`.

### Sauvegardes de la base
Le service `backup` (dans `compose.yaml`) sauvegarde la base au démarrage puis toutes les 24 h, dans le dossier `backups/` du site sur la machine (7 jours conservés). C'est un dossier et non un volume Docker : il survit à un `docker compose down -v`. Les photos de la galerie n'y sont pas (elles sont sur le stockage d'images).
- Sauvegarde immédiate : `docker compose restart backup`
- Restaurer (remplace le contenu actuel de la base) :
  ```bash
  docker compose stop app
  gunzip -c backups/site-AAAA-MM-JJ_HHhMM.sql.gz | docker exec -i <SITE_ID>-db psql -U site -d site
  docker compose start app
  ```
- Ces copies restent sur la même machine : elles protègent des erreurs de manipulation, pas de la perte du serveur (pour ça : les sauvegardes de l'hébergeur).

### Bot Discord
Géré à part ([roxwood-network-famille](https://github.com/poulpizar01/roxwood-network-famille)). Détail de la liaison, des rubriques lues, du cache et des limites : [docs/api.md](../docs/api.md#api-du-bot-discord-relayée). L'espace membre lit ses données via son **API REST, en lecture seule** : rien n'est écrit dans le bot ni stocké côté site.
- `.env` : `BOT_API_URL` = URL publique de l'API du bot (vide = pages liées au bot désactivées).
- Discord : un admin du serveur déclare le site comme site externe du bot : `/config site-externe set url:https://<domaine>/espace/bot-callback.html`.
- **Une seule URL par serveur Discord** : le bot renvoie chaque connexion vers le dernier site externe déclaré. Déclarer `http://localhost:3000/…` pour tester en dev coupe la connexion au bot en prod (et inversement). Tester le bot en dev sur un **serveur Discord de test**, ou redéclarer l'URL de prod juste après.
- Chaque membre connecte son compte au bot depuis l'espace membre (bouton « Connecter mon compte au bot ») : le bot vérifie son identité Discord et renvoie un jeton personnel (7 jours), gardé dans sa session. Les droits (admin) sont ceux de ses rôles Discord, revérifiés par le bot à chaque lecture.

## Application Discord
Une par site.
1. https://discord.com/developers/applications → New Application (nom du site)
2. OAuth2 → Client ID / Client Secret → `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` dans `.env`
3. OAuth2 → Redirects → ajouter `https://<domaine>/auth/discord/callback`
4. `DISCORD_GUILD_ID` = ID du serveur (mode développeur → clic droit sur le serveur → Copier l'identifiant). Seuls ses membres peuvent entrer.
5. Le **propriétaire du serveur Discord** est propriétaire du site : validé d'office, tous les droits quel que soit son grade (vérifié à chaque connexion). C'est lui qui crée les premiers grades.
6. Grades : ils se créent et se règlent dans l'espace membre → Gestion → Hiérarchie (nom, ordre, couleur, droits, grade par défaut). Pour que le grade suive un rôle Discord, renseigner l'ID du rôle sur le grade concerné.

## Images (galerie)
- **Dev** : les photos sont écrites dans `uploads/` à la racine du dépôt, sur le poste.
- **Prod** : avec `STORAGE_URL` et `STORAGE_TOKEN`, elles partent sur le service de stockage (CDN) sous le préfixe `STORAGE_PREFIX` (un par site) et la base garde leur URL publique. Sans eux, elles restent sur le serveur (volume Docker `uploads` du site). Fonctionnement complet et contrat attendu du service : [docs/stockage.md](../docs/stockage.md).

Toutes les variables : [`.env.example`](../.env.example).
