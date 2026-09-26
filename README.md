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

## Production
Voir [server/README.md](server/README.md).

## Organisation
- `index.html`, `accueil.html` — site vitrine (blason 3D `hero3d.js`, organigramme `org.js`, galerie `galeria.js`, `main.js`)
- `styles.css` — direction artistique (noir, bronze, or) ; `assets/` — logo, médaillon, favicon, image de partage
- `casa/` — pages de La Casa
- `server/` — serveur (`src/`), schéma SQL (`sql/`), déploiement (`deploy/`)
