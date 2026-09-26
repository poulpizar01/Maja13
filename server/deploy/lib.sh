# Commun aux scripts de déploiement (à « sourcer ») : chemins déduits de
# l'emplacement du dépôt, rien n'est codé en dur.
DEPLOY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$(cd "$DEPLOY/../.." && pwd)"          # racine du dépôt La Maja 13
ENV="$APP/server/.env"

# docker compose du site en prod : compose.yaml seul, variables de server/.env (HOST_PORT…)
casa_compose() { docker compose --env-file "$ENV" -f "$APP/compose.yaml" "$@"; }   # sans compose.override.yaml (dev)
exiger_root() { [ "$(id -u)" -eq 0 ] || { echo "Lance-moi avec sudo."; exit 1; }; }
