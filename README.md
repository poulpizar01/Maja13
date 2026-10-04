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
- `theme.css` — couleurs et polices (noir, bronze, or ; Pirata One, Cinzel, EB Garamond), appliquées aussi à La Casa. Les polices sont dans `assets/fonts/`, servies par le site (rien n'est chargé depuis Google Fonts).
- `index.html` (entrée), `accueil.html`, `styles.css` — vitrine (blason 3D `hero3d.js`) ; `assets/` — logo, médaillon, favicon, image de partage.
- `sw.js` — désinstalle l'ancien service worker de M13 OS (supprimé le 26/09/2026). À garder jusqu'à fin novembre 2026 : un navigateur qui a encore l'ancien service worker ne s'en débarrasse qu'en récupérant ce fichier.

## Développement
Prérequis : Docker Desktop.
```bash
docker compose up          # http://localhost:3000  ·  La Casa : http://localhost:3000/espace/
```
- Créer un `.env` à la racine (ignoré par git) contenant au moins `SITE_ID=maja13` : sans lui, le projet Docker s'appelle `site`, comme celui du modèle, et les deux partageraient la même base.
- Connexion sans Discord (bouton de connexion → compte « Dev local » avec tous les droits). Pour essayer un autre niveau d'accès : `http://localhost:3000/auth/discord?compte=<ID Discord>` ouvre la session d'un compte existant (dev uniquement, refusé en production).
- Pages, CSS, JS et `site.json` : rafraîchir le navigateur suffit. Serveur (`server/src`) : `docker compose restart app`.
- Tester avec le bot Discord : ajouter au `.env` (avec `SITE_ID`) `BOT_API_URL`, `DISCORD_GUILD_ID` et `DEV_DISCORD_ID`, rien d'autre, et déclarer `http://localhost:3000/espace/bot-callback.html` comme site externe du bot **sur un serveur Discord de test**. Ne pas copier `.env.example` en dev (sa ligne `COMPOSE_FILE` désactive les réglages de dev).

## Production
Déploiement, mises à jour, sauvegardes et retour en arrière : [server/README.md](server/README.md) ; nginx : [docs/nginx.md](docs/nginx.md).
