#!/usr/bin/env bash
# ==========================================================================
#  Installation / reconfiguration de La Maja 13 sur le serveur
#    git clone <dépôt> <dossier> && sudo bash <dossier>/server/deploy/vps-setup.sh
#
#  Prérequis : Docker (avec docker compose) et nginx sur la machine.
#  Le site et sa base tournent dans Docker ; le site n'écoute que sur
#  127.0.0.1:<port> et nginx l'expose (HTTPS via certbot ou ta méthode).
#
#  Le script est REJOUABLE : il conserve les secrets déjà en place (mot de
#  passe de la base, clé de session) et met à jour le reste.
# ==========================================================================
set -euo pipefail
source "$(dirname "$0")/lib.sh"
exiger_root

# Valeurs existantes : on ne régénère JAMAIS un secret déjà utilisé.
# Régénérer POSTGRES_PASSWORD casserait la connexion à la base existante,
# dont le volume conserve l'ancien mot de passe.
lire() { [ -f "$ENV" ] && sed -n "s/^$1=//p" "$ENV" | head -1 || true; }

OLD_DOMAIN="$(lire BASE_URL | sed 's|^https\?://||')"
OLD_PORT="$(lire HOST_PORT)"
OLD_SESSION="$(lire SESSION_SECRET)"
OLD_PGPASS="$(lire POSTGRES_PASSWORD)"
OLD_CID="$(lire DISCORD_CLIENT_ID)"
OLD_CSECRET="$(lire DISCORD_CLIENT_SECRET)"
OLD_GUILD="$(lire DISCORD_GUILD_ID)"
OLD_ADMINS="$(lire ADMIN_DISCORD_IDS)"
OLD_STORAGE_URL="$(lire STORAGE_URL)"
OLD_STORAGE="$(lire STORAGE_TOKEN)"
OLD_BOT_DB="$(lire BOT_DATABASE_URL)"
OLD_BOT_API="$(lire BOT_API_URL)"
OLD_BOT_TOKEN="$(lire BOT_API_TOKEN)"

demander() {  # demander <invite> <valeur_actuelle> <variable_de_sortie> [-s]
  local invite="$1" actuel="$2" sortie="$3" secret="${4:-}" reponse
  if [ -n "$actuel" ]; then
    if [ "$secret" = "-s" ]; then invite="$invite [inchangé si vide]"
    else invite="$invite [$actuel]"; fi
  fi
  if [ "$secret" = "-s" ]; then read -rsp "$invite : " reponse; echo
  else read -rp "$invite : " reponse; fi
  printf -v "$sortie" '%s' "${reponse:-$actuel}"
}

echo "=== La Maja 13 — configuration ($APP) ==="
[ -f "$ENV" ] && echo "(.env existant : laisse vide pour conserver la valeur actuelle)"
demander "Nom de domaine du site"                       "$OLD_DOMAIN"  DOMAIN
demander "Port local du site (nginx → 127.0.0.1:port)"  "${OLD_PORT:-3000}" HOST_PORT
demander "Discord Client ID"                            "$OLD_CID"     CID
demander "Discord Client Secret"                        "$OLD_CSECRET" CSECRET -s
demander "ID du serveur Discord (guild)"                "$OLD_GUILD"   GUILD
demander "IDs Discord des propriétaires (virgules)"     "$OLD_ADMINS"  ADMINS
demander "URL du stockage d'images (vide = disque du serveur)" "$OLD_STORAGE_URL" STORAGE_URL
[ -n "$STORAGE_URL" ] && demander "Token du stockage d'images" "$OLD_STORAGE" STORAGE -s || STORAGE=""
echo "Bot Discord (géré à part ; valeurs fournies par son équipe, vide = pages du bot désactivées) :"
demander "  Base du bot, accès lecture seule (postgresql://…)" "$OLD_BOT_DB" BOT_DB -s
demander "  URL de l'API interne du bot"                     "$OLD_BOT_API" BOT_API
[ -n "$BOT_API" ] && demander "  Jeton de l'API du bot" "$OLD_BOT_TOKEN" BOT_TOKEN -s || BOT_TOKEN=""

[ -n "$DOMAIN" ] || { echo "Le nom de domaine est obligatoire."; exit 1; }
[[ "$HOST_PORT" =~ ^[0-9]+$ ]] || { echo "Port invalide : $HOST_PORT"; exit 1; }

SESSION_SECRET="${OLD_SESSION:-$(openssl rand -hex 32)}"
POSTGRES_PASSWORD="${OLD_PGPASS:-$(openssl rand -hex 16)}"
[ -n "$OLD_PGPASS" ] && echo "-> mot de passe de la base conservé"

[ -f "$ENV" ] && cp "$ENV" "$ENV.bak.$(date +%s)"
cat > "$ENV" <<ENVF
BASE_URL=https://$DOMAIN
HOST_PORT=$HOST_PORT
SESSION_SECRET=$SESSION_SECRET
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
DISCORD_CLIENT_ID=$CID
DISCORD_CLIENT_SECRET=$CSECRET
DISCORD_GUILD_ID=$GUILD
ADMIN_DISCORD_IDS=$ADMINS
STORAGE_URL=$STORAGE_URL
STORAGE_TOKEN=$STORAGE
BOT_DATABASE_URL=$BOT_DB
BOT_API_URL=$BOT_API
BOT_API_TOKEN=$BOT_TOKEN
ENVF
chmod 600 "$ENV"
echo "-> $ENV écrit."

# --------------------------------------------------------------------------
#  nginx : site généré depuis nginx.conf.template (sites-available / sites-enabled)
# --------------------------------------------------------------------------
NGINX_SITE=/etc/nginx/sites-available/maja13
if [ -d /etc/nginx/sites-available ]; then
  [ -f "$NGINX_SITE" ] && cp "$NGINX_SITE" "$NGINX_SITE.bak.$(date +%s)"
  if [ -f "$NGINX_SITE" ] && grep -q "managed by Certbot" "$NGINX_SITE"; then
    # certbot a déjà ajouté le HTTPS : on ne met à jour que le port, sans perdre ses lignes
    sed -i -E "s#proxy_pass http://127\.0\.0\.1:[0-9]+;#proxy_pass http://127.0.0.1:$HOST_PORT;#" "$NGINX_SITE"
    echo "-> $NGINX_SITE : port mis à jour (configuration HTTPS de certbot conservée)."
  else
    sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__PORT__/$HOST_PORT/g" "$DEPLOY/nginx.conf.template" > "$NGINX_SITE"
    echo "-> $NGINX_SITE écrit."
  fi
  ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/maja13
  nginx -t && systemctl reload nginx && echo "-> nginx rechargé."
else
  echo "/!\\ /etc/nginx/sites-available absent : adapte $DEPLOY/nginx.conf.template à ta configuration nginx."
fi

# --------------------------------------------------------------------------
#  Construction et démarrage
# --------------------------------------------------------------------------
echo "=== Construction et démarrage ==="
casa_compose up -d --build

echo
echo "=== Terminé ==="
echo "Site : https://$DOMAIN      Espace membre : https://$DOMAIN/casa/"
grep -q "managed by Certbot" "$NGINX_SITE" 2>/dev/null || echo "HTTPS : sudo certbot --nginx -d $DOMAIN   (ou ta méthode habituelle)"
echo "Discord (OAuth2 → Redirects) : https://$DOMAIN/auth/discord/callback"
echo "Logs : sudo docker logs -f maja13-app-1"
