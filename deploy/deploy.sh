#!/bin/sh
# Ships the project to the server and (re)starts it with Docker Compose (production files).
#   DEPLOY_HOST=root@SERVER_IP npm run deploy          (or put DEPLOY_HOST / DEPLOY_DIR / DEPLOY_SSH_KEY in deploy/.deploy.env)
# Copies the source (no node_modules, no local data) and .env.production, builds the image ON the server and
# restarts the containers. The database and uploads live in the server's Docker volume and are never overwritten.
set -eu
cd "$(dirname "$0")/.."

[ -f deploy/.deploy.env ] && . deploy/.deploy.env
HOST="${DEPLOY_HOST:?set DEPLOY_HOST=user@server (or deploy/.deploy.env)}"
DIR="${DEPLOY_DIR:-/opt/nova}"

# Optional DEPLOY_SSH_KEY=path/to/private_key: use that key for ssh / scp / rsync instead of ssh-agent / ~/.ssh/config.
SSH="ssh"
SCP="scp"
if [ -n "${DEPLOY_SSH_KEY:-}" ]; then
	[ -f "$DEPLOY_SSH_KEY" ] || { echo "✖ DEPLOY_SSH_KEY not found: $DEPLOY_SSH_KEY"; exit 1; }
	SSH="ssh -i $DEPLOY_SSH_KEY -o IdentitiesOnly=yes"
	SCP="scp -i $DEPLOY_SSH_KEY -o IdentitiesOnly=yes"
fi

[ -f .env.production ] || { echo "✖ .env.production missing (template: .env.production.example)"; exit 1; }
for key in DOMAIN ACME_EMAIL PUBLIC_SITE_URL SESSION_SECRET SECRETS_MASTER_KEY CRON_SECRET MEILI_MASTER_KEY; do
	grep -Eq "^${key}=.+" .env.production || { echo "✖ .env.production: ${key} is empty"; exit 1; }
done

echo "→ syncing source to ${HOST}:${DIR}"
$SSH "$HOST" "mkdir -p '$DIR'"
rsync -az --delete -e "$SSH" \
	--exclude .git --exclude node_modules --exclude .next --exclude /data --exclude test-results \
	--exclude playwright-report --exclude '.env' --exclude '.env.*' --exclude '*.tsbuildinfo' \
	--exclude '* 2.*' --exclude .DS_Store --exclude deploy/.deploy.env \
	./ "$HOST:$DIR/"
$SCP -q .env.production "$HOST:$DIR/.env.production"

echo "→ building and starting containers"
$SSH "$HOST" "cd '$DIR' && chmod 600 .env.production \
	&& printf 'COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml\n' > .env \
	&& grep -E '^MEILI_MASTER_KEY=' .env.production >> .env && chmod 600 .env \
	&& docker compose up -d --build --remove-orphans \
	&& docker image prune -f > /dev/null \
	&& docker compose ps"
echo "✓ deployed — $(grep -E '^PUBLIC_SITE_URL=' .env.production | cut -d= -f2-)"
