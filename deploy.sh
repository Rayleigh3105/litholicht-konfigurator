#!/bin/bash
# Deploy script - auf dem VPS ausführen
# Wird von Webhook oder manuell getriggert

set -e

REPO_DIR="/var/www/litholicht-konfigurator"
REPO_URL="https://git.tecmaxx.de/mamotec/litholicht-konfigurator.git"

# Falls Repo nicht existiert, klonen
if [ ! -d "$REPO_DIR/.git" ]; then
    git clone "$REPO_URL" "$REPO_DIR"
fi

cd "$REPO_DIR"

# Neuesten Code holen
git fetch origin
git reset --hard origin/main

# Dependencies installieren und bauen
npm ci
npm run build

# Nginx reload (optional)
sudo systemctl reload nginx || true

echo "✅ Deployment fertig!"
