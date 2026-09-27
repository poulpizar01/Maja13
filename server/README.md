# La Casa — serveur et déploiement

Express + PostgreSQL + Discord OAuth. Sert aussi le site vitrine (racine du dépôt). Pour le développement, voir le [README de la racine](../README.md).

## Production
Tout tourne dans Docker, avec le même [`compose.yaml`](../compose.yaml) qu'en dev (site + base + sauvegardes). Le site n'écoute que sur `127.0.0.1:<HOST_PORT>` ; **nginx**, sur la machine, l'expose en HTTPS.

Les commandes ci-dessous visent un VPS Debian / Ubuntu, avec un utilisateur qui a `sudo`.

### 1. Avant de commencer
- **Domaine** : un enregistrement DNS `A` (et `AAAA` si le VPS a une IPv6) du domaine vers l'IP du VPS. Vérifier avec `dig +short <domaine>` : certbot échoue tant que le domaine ne pointe pas sur la machine.
- **Application Discord** : créée et configurée (voir [Application Discord](#application-discord)), avec la redirection `https://<domaine>/auth/discord/callback`.
- **Bot Discord** (facultatif) : l'URL publique HTTPS de son API.

### 2. Préparer le VPS (une seule fois)
```bash
# Docker (script officiel : Docker Engine + docker compose), démarré avec la machine
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER            # puis se déconnecter / reconnecter pour utiliser docker sans sudo
# nginx, certbot, git
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx git
# pare-feu : SSH + web (si ufw est utilisé ; sinon, ouvrir 80 et 443 dans le pare-feu de l'hébergeur)
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```
Choisir le port local du site (`HOST_PORT`) : `ss -ltnp` liste les ports déjà pris (par exemple par l'API du bot si elle tourne sur la même machine) ; en prendre un libre.

### 3. Installer le site
```bash
git clone -b main https://github.com/poulpizar01/Maja13.git maja13 && cd maja13
cp .env.example .env && chmod 600 .env
nano .env                                   # remplir : tout est expliqué dans le fichier
docker compose up -d --build
```
Le serveur suit la branche `main` : c'est elle qui est déployée. Générer `SESSION_SECRET` et `POSTGRES_PASSWORD` avec `openssl rand -hex 32` (le mot de passe de la base ne se change plus une fois la base créée).

Vérifier : `docker compose ps` (les trois services `Up`, la base `healthy`) et `docker logs maja13-app-1`, qui doit finir par `La Maja 13 en écoute sur le port 3000 (https://<domaine>)`. Le premier démarrage crée les tables (migrations Prisma).

### 4. nginx et HTTPS
```bash
sudo cp server/deploy/nginx.conf.example /etc/nginx/sites-available/maja13
sudo nano /etc/nginx/sites-available/maja13            # remplacer __DOMAIN__ et __PORT__ (= HOST_PORT)
sudo ln -s /etc/nginx/sites-available/maja13 /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d <domaine>                      # certificat + redirection http → https, renouvelé automatiquement
```
**Ne pas tester la connexion avant certbot** : avec `BASE_URL` en `https://`, le cookie de session n'est envoyé qu'en HTTPS, la connexion Discord échoue donc en `http://`.

### 5. Première connexion
La base de prod démarre **vide** (rien n'est repris du dev). Le **propriétaire du serveur Discord** se connecte le premier : il est validé d'office avec tous les droits et crée les grades dans La Casa → Gestion → Hiérarchie. Les autres membres qui se connectent attendent ensuite sa validation.

Puis, si le bot est utilisé : voir [Bot Discord](#bot-discord).

### 6. Adapter le domaine dans les fichiers du site
Le domaine est écrit en dur dans les fichiers statiques (référencement et aperçus de partage) : `robots.txt` (ligne `Sitemap`), `sitemap.xml`, et les balises `og:url` / `og:image` de `index.html` et `accueil.html`. Si le domaine n'est pas `lamaja13.fbfa.fr`, les modifier dans le dépôt, pousser sur `main` et mettre à jour (ci-dessous).

### Au quotidien (dans le dossier du dépôt)
- Mise à jour après un push sur `main` : `git pull && docker compose up -d --build` (les nouvelles migrations sont appliquées au démarrage), puis `docker image prune -f` pour effacer les anciennes images.
- Changer la configuration : modifier `.env`, puis `docker compose up -d`
- Logs : `docker logs -f maja13-app-1` (limités à 3 × 10 Mo par service, voir `compose.yaml`)
- État : `docker compose ps`

Le `.env` contient `COMPOSE_FILE=compose.yaml` : les commandes ci-dessus ignorent ainsi les réglages de dev (`compose.override.yaml`).

### Revenir en arrière après une mise à jour ratée
Les migrations de la base ne s'annulent pas : revenir à un ancien commit ne suffit pas si la mise à jour en contenait une.
1. Revenir au code précédent : `git log --oneline`, puis `git checkout <commit>` et `docker compose up -d --build`.
2. Si la mise à jour contenait une migration (`server/prisma/migrations/`) : restaurer la dernière sauvegarde **antérieure** à la mise à jour (voir ci-dessous). Les écritures faites entre-temps sont perdues.
3. Une fois le problème corrigé sur `main` : `git checkout main && git pull && docker compose up -d --build`.

Faire une sauvegarde juste avant une mise à jour qui touche la base : `docker compose restart maja13-backup`.

### Sauvegardes de la base
Le service `maja13-backup` (dans `compose.yaml`) sauvegarde la base au démarrage puis toutes les 24 h, dans le dossier `backups/` du dépôt sur la machine (7 jours conservés). C'est un dossier et non un volume Docker : il survit à un `docker compose down -v`. Les photos de la galerie n'y sont pas (elles sont sur le stockage d'images).
- Sauvegarde immédiate : `docker compose restart maja13-backup`
- Restaurer (remplace le contenu actuel de la base) :
  ```bash
  docker compose stop maja13-app
  gunzip -c backups/maja13-AAAA-MM-JJ_HHhMM.sql.gz | docker exec -i maja13-db-1 psql -U maja13 -d maja13
  docker compose start maja13-app
  ```
- Ces copies restent sur la même machine : elles protègent des erreurs de manipulation, pas de la perte du serveur (pour ça : les sauvegardes de l'hébergeur).

### Bot Discord
Géré à part. La Casa lit ses données via son **API REST, en lecture seule** : rien n'est écrit dans le bot ni stocké côté La Casa.
- `.env` : `BOT_API_URL` = URL publique de l'API du bot (vide = pages liées au bot désactivées).
- Discord : un admin du serveur déclare La Casa comme site externe du bot : `/config site-externe set url:https://<domaine>/casa/bot-callback.html`.
- **Une seule URL par serveur Discord** : le bot renvoie chaque connexion vers le dernier site externe déclaré. Déclarer `http://localhost:3000/…` pour tester en dev coupe la connexion au bot en prod (et inversement). Tester le bot en dev sur un **serveur Discord de test**, ou redéclarer l'URL de prod juste après.
- Chaque membre connecte son compte au bot depuis La Casa (bouton « Connecter mon compte au bot ») : le bot vérifie son identité Discord et renvoie un jeton personnel (7 jours), gardé dans sa session La Casa. Les droits (admin) sont ceux de ses rôles Discord, revérifiés par le bot à chaque lecture.

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
