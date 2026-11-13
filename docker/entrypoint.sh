#!/bin/sh
# Brings the database up to date before the server starts: schema.sql (idempotent), seed on a brand-new
# database (SEED_ON_INIT, default true), pending db/migrations. The scheduler container sets SKIP_DB_INIT=true.
set -e
if [ "${SKIP_DB_INIT:-false}" != "true" ]; then
	node scripts/db.mjs init
fi
exec "$@"
