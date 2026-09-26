#!/usr/bin/env bash
# Mise à jour après un push GitHub :  sudo bash <dossier>/server/deploy/vps-update.sh
set -euo pipefail
source "$(dirname "$0")/lib.sh"
exiger_root
git -C "$APP" pull --ff-only
casa_compose up -d --build
echo "La Maja 13 mise à jour."
