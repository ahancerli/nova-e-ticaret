#!/bin/sh
# Litestream container (docker-compose.prod.yml). Before the app starts: if /data/nova.db is missing (new or rebuilt
# server) it is restored from the bucket; then every change is replicated. Without LITESTREAM_BUCKET it only idles,
# so the app is never blocked by a missing backup setup.
set -e
DB=/data/nova.db
log() { echo "{\"time\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"level\":\"$1\",\"source\":\"litestream\",\"msg\":\"$2\"}"; }

if [ -z "$LITESTREAM_BUCKET" ]; then
	log warn "LITESTREAM_BUCKET is empty: continuous off-server backup is OFF"
	touch /tmp/ready
	while :; do sleep 3600; done
fi

if [ ! -f "$DB" ]; then
	log info "no database on disk: restoring the latest replica (if any)"
	litestream restore -config /etc/litestream.yml -if-replica-exists "$DB"
fi
touch /tmp/ready
log info "replicating $DB to s3://$LITESTREAM_BUCKET/$LITESTREAM_PATH"
exec litestream replicate -config /etc/litestream.yml
