#!/usr/bin/env bash
# ==========================================================================
#  Installation / mise a jour de La Maja 13 sur le VPS
#    sudo bash /opt/maja13/server/deploy/vps-setup.sh
#
#  Le script est REJOUABLE : relance-le sans crainte, il conserve les
#  secrets deja en place (mot de passe de la base, cle de session) et se
#  contente de mettre a jour ce qui doit l'etre.
#
#  Il s'adapte a l'organisation du reverse proxy :
#    - /opt/vps-proxy/sites.d/  s'il existe (organisation actuelle)
#    - l'ancien Caddyfile partage de Dynasty 8 sinon
# ==========================================================================
set -euo pipefail

APP=/opt/maja13
PROXY_DIR=/opt/vps-proxy
OLD_CADDYFILE=/opt/dynasty8/deploy/vps/Caddyfile
DYN_COMPOSE=/opt/dynasty8/deploy/vps/compose.yaml
ENV="$APP/server/.env"

[ "$(id -u)" -eq 0 ] || { echo "Lance-moi avec sudo."; exit 1; }
[ -d "$APP/server" ] || { echo "Le code n'est pas dans $APP (git clone d'abord)."; exit 1; }

# --------------------------------------------------------------------------
#  Valeurs existantes : on ne regenere JAMAIS un secret deja utilise.
#  Regenerer POSTGRES_PASSWORD casserait la connexion a la base existante,
#  dont le volume conserve l'ancien mot de passe.
# --------------------------------------------------------------------------
lire() { [ -f "$ENV" ] && sed -n "s/^$1=//p" "$ENV" | head -1 || true; }

OLD_DOMAIN="$(lire BASE_URL | sed 's|^https\?://||')"
OLD_SESSION="$(lire SESSION_SECRET)"
OLD_PGPASS="$(lire POSTGRES_PASSWORD)"
OLD_CID="$(lire DISCORD_CLIENT_ID)"
OLD_CSECRET="$(lire DISCORD_CLIENT_SECRET)"
OLD_GUILD="$(lire DISCORD_GUILD_ID)"
OLD_ADMINS="$(lire ADMIN_DISCORD_IDS)"
OLD_STORAGE_URL="$(lire STORAGE_URL)"
OLD_STORAGE="$(lire STORAGE_TOKEN)"

demander() {  # demander <invite> <valeur_actuelle> <variable_de_sortie> [-s]
  local invite="$1" actuel="$2" sortie="$3" secret="${4:-}" reponse
  if [ -n "$actuel" ]; then
    if [ "$secret" = "-s" ]; then invite="$invite [inchange si vide]"
    else invite="$invite [$actuel]"; fi
  fi
  if [ "$secret" = "-s" ]; then read -rsp "$invite : " reponse; echo
  else read -rp "$invite : " reponse; fi
  printf -v "$sortie" '%s' "${reponse:-$actuel}"
}

echo "=== La Maja 13 — configuration ==="
[ -f "$ENV" ] && echo "(.env existant detecte : laisse vide pour conserver la valeur actuelle)"
demander "Nom de domaine (ex: lamaja13.duckdns.org)" "$OLD_DOMAIN" DOMAIN
demander "Discord Client ID"                          "$OLD_CID"    CID
demander "Discord Client Secret"                      "$OLD_CSECRET" CSECRET -s
demander "ID du serveur Discord (guild)"              "$OLD_GUILD"  GUILD
demander "IDs Discord des admins (virgules, optionnel)" "$OLD_ADMINS" ADMINS
demander "URL du stockage d'images (vide = disque du serveur)" "$OLD_STORAGE_URL" STORAGE_URL
[ -n "$STORAGE_URL" ] && demander "Token du stockage d'images" "$OLD_STORAGE" STORAGE -s || STORAGE=""

[ -n "$DOMAIN" ] || { echo "Le nom de domaine est obligatoire."; exit 1; }

SESSION_SECRET="${OLD_SESSION:-$(openssl rand -hex 32)}"
POSTGRES_PASSWORD="${OLD_PGPASS:-$(openssl rand -hex 16)}"
[ -n "$OLD_PGPASS" ] && echo "-> mot de passe de la base conserve (ne jamais le regenerer : la base existante le refuserait)"

[ -f "$ENV" ] && cp "$ENV" "$ENV.bak.$(date +%s)"
cat > "$ENV" <<ENVF
PORT=3000
BASE_URL=https://$DOMAIN
SESSION_SECRET=$SESSION_SECRET
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
DISCORD_CLIENT_ID=$CID
DISCORD_CLIENT_SECRET=$CSECRET
DISCORD_GUILD_ID=$GUILD
ADMIN_DISCORD_IDS=$ADMINS
STORAGE_URL=$STORAGE_URL
STORAGE_TOKEN=$STORAGE
ENVF
chmod 600 "$ENV"
echo "-> $ENV ecrit."

# --------------------------------------------------------------------------
#  Configuration du reverse proxy
#
#  Le bloc "http://" explicite est indispensable : l'attrape-tout ":80" de
#  Dynasty 8 empeche Caddy d'installer sa redirection automatique vers HTTPS.
#  Sans lui, http://lamaja13... atterrit sur Dynasty 8.
#
#  On vise le NOM DU CONTENEUR (maja13-app-1) et non le nom du service :
#  sur un reseau partage, deux projets peuvent avoir un service homonyme.
# --------------------------------------------------------------------------
bloc_caddy() {
  cat <<CADDY
# --- La Maja 13 ---
http://$DOMAIN {
	redir https://{host}{uri} permanent
}

$DOMAIN {
	encode gzip
	reverse_proxy maja13-app-1:3000
}
CADDY
}

RECHARGE=""
if [ -d "$PROXY_DIR/sites.d" ]; then
  bloc_caddy > "$PROXY_DIR/sites.d/maja13.caddy"
  echo "-> $PROXY_DIR/sites.d/maja13.caddy ecrit."
  RECHARGE="proxy"
elif [ -f "$OLD_CADDYFILE" ]; then
  echo "/!\\ /opt/vps-proxy absent : ecriture dans l'ancien Caddyfile partage."
  cp "$OLD_CADDYFILE" "$OLD_CADDYFILE.avant-maja13.$(date +%s)"
  # On retire un eventuel ancien bloc avant de le reecrire, pour rester rejouable.
  python3 - "$OLD_CADDYFILE" "$DOMAIN" <<'PY'
import io, re, sys
p, dom = sys.argv[1], sys.argv[2]
s = io.open(p, encoding='utf-8').read()
s = re.sub(r'(?ms)^# --- La Maja 13 ---.*?(?=^\S|\Z)', '', s)
s = re.sub(r'(?ms)^(?:http://)?%s\s*\{.*?^\}\s*' % re.escape(dom), '', s)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s.rstrip() + '\n')
PY
  { echo; bloc_caddy; } >> "$OLD_CADDYFILE"
  echo "-> bloc ajoute dans $OLD_CADDYFILE"
  RECHARGE="ancien"
else
  echo "/!\\ Aucun reverse proxy trouve — configure-le a la main."
fi

# --------------------------------------------------------------------------
#  Construction et demarrage
# --------------------------------------------------------------------------
echo "=== Construction et demarrage ==="
docker compose -f "$APP/server/deploy/docker-compose.yml" up -d --build

# Rechargement a chaud plutot qu'un redemarrage : aucune coupure sur les
# autres sites servis par le meme Caddy.
case "$RECHARGE" in
  proxy)
    docker exec proxy-caddy caddy validate --config /etc/caddy/Caddyfile
    docker exec proxy-caddy caddy reload   --config /etc/caddy/Caddyfile
    echo "-> proxy recharge."
    ;;
  ancien)
    docker exec vps-caddy-1 caddy validate --config /etc/caddy/Caddyfile \
      && docker exec vps-caddy-1 caddy reload --config /etc/caddy/Caddyfile \
      || docker compose -f "$DYN_COMPOSE" restart caddy
    echo "-> Caddy recharge."
    ;;
esac

echo
echo "=== Termine ==="
echo "Site : https://$DOMAIN      Espace membre : https://$DOMAIN/casa/"
echo "Dans le portail Discord, le redirect doit etre : https://$DOMAIN/auth/discord/callback"
echo "Logs : sudo docker logs -f maja13-app-1"
