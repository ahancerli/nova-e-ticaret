#!/bin/sh
# Ships the project to the server and (re)starts it with Docker Compose (production files).
#   DEPLOY_HOST=root@SERVER_IP npm run deploy          (or put DEPLOY_HOST / DEPLOY_DIR in deploy/.deploy.env)
# Copies the source (no node_modules, no local data) and .env.production, builds the image ON the server and
# restarts the containers. The database and uploads live in the server's Docker volume and are never overwritten.
set -eu
cd "$(dirname "$0")/.."

[ -f deploy/.deploy.env ] && . deploy/.deploy.env
HOST="${DEPLOY_HOST:?set DEPLOY_HOST=user@server (or deploy/.deploy.env)}"
DIR="${DEPLOY_DIR:-/opt/nova}"

[ -f .env.production ] || { echo "✖ .env.production missing (template: .env.production.example)"; exit 1; }
for key in DOMAIN ACME_EMAIL PUBLIC_SITE_URL SESSION_SECRET SECRETS_MASTER_KEY CRON_SECRET; do
	grep -Eq "^${key}=.+" .env.production || { echo "✖ .env.production: ${key} is empty"; exit 1; }
done

echo "→ syncing source to ${HOST}:${DIR}"
ssh "$HOST" "mkdir -p '$DIR'"
rsync -az --delete \
	--exclude .git --exclude node_modules --exclude .next --exclude data --exclude test-results \
	--exclude playwright-report --exclude '.env' --exclude '.env.*' --exclude '*.tsbuildinfo' \
	--exclude '* 2.*' --exclude .DS_Store --exclude deploy/.deploy.env \
	./ "$HOST:$DIR/"
scp -q .env.production "$HOST:$DIR/.env.production"

echo "→ building and starting containers"
ssh "$HOST" "cd '$DIR' && chmod 600 .env.production \
	&& printf 'COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml\n' > .env \
	&& docker compose up -d --build --remove-orphans \
	&& docker image prune -f > /dev/null \
	&& docker compose ps"
echo "✓ deployed — $(grep -E '^PUBLIC_SITE_URL=' .env.production | cut -d= -f2-)"
