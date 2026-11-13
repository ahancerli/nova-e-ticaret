#!/bin/sh
# Nova — local stack with plain `docker run` (same setup as docker-compose.yml + docker-compose.override.yml).
#   sh docker/run.sh          build the image, start kafka → kafka-rest → app (SQLite in ./data) → scheduler
#   sh docker/run.sh down     stop and remove the containers (network, volumes and ./data are kept)
# SQLite is not a separate server: the app opens /data/nova.db, which is ./data/nova.db on the host.
# Do not run `npm run dev` against ./data at the same time.
set -e
cd "$(dirname "$0")/.."

NET=nova
CONTAINERS="nova-scheduler nova-app nova-kafka-rest nova-kafka"

if [ "$1" = "down" ]; then
	docker rm -f $CONTAINERS 2>/dev/null || true
	exit 0
fi

wait_healthy() {
	printf "waiting for %s" "$1"
	until [ "$(docker inspect -f '{{.State.Health.Status}}' "$1" 2>/dev/null)" = "healthy" ]; do
		printf "."
		sleep 3
	done
	echo " healthy"
}

docker network inspect $NET >/dev/null 2>&1 || docker network create $NET
docker volume inspect nova-kafka-data >/dev/null 2>&1 || docker volume create nova-kafka-data
docker rm -f $CONTAINERS 2>/dev/null || true
mkdir -p data

docker build -t nova-app:latest .

# Single-node Kafka (KRaft, no ZooKeeper), only reachable inside the network.
docker run -d --name nova-kafka --network $NET --network-alias kafka --restart unless-stopped \
	-e CLUSTER_ID=bm92YS1rYWZrYS1jbHVzdGVy \
	-e KAFKA_NODE_ID=1 \
	-e KAFKA_PROCESS_ROLES=broker,controller \
	-e KAFKA_CONTROLLER_QUORUM_VOTERS=1@kafka:9093 \
	-e KAFKA_LISTENERS=PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093 \
	-e KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://kafka:9092,CONTROLLER://kafka:9093 \
	-e KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT \
	-e KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER \
	-e KAFKA_INTER_BROKER_LISTENER_NAME=PLAINTEXT \
	-e KAFKA_LOG_DIRS=/var/lib/kafka/data \
	-e KAFKA_AUTO_CREATE_TOPICS_ENABLE=true \
	-e KAFKA_NUM_PARTITIONS=1 \
	-e KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1 \
	-e KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1 \
	-e KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1 \
	-e KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS=0 \
	-e KAFKA_LOG_RETENTION_HOURS=168 \
	-e "KAFKA_HEAP_OPTS=-Xms256m -Xmx512m" \
	-v nova-kafka-data:/var/lib/kafka/data \
	--health-cmd "kafka-broker-api-versions --bootstrap-server localhost:9092 > /dev/null 2>&1" \
	--health-interval 10s --health-timeout 10s --health-retries 12 --health-start-period 20s \
	confluentinc/cp-kafka:7.9.0
wait_healthy nova-kafka

# Kafka REST Proxy v2: the app's KafkaRestBus produces / consumes through it.
docker run -d --name nova-kafka-rest --network $NET --network-alias kafka-rest --restart unless-stopped \
	-p 127.0.0.1:8082:8082 \
	-e KAFKA_REST_HOST_NAME=kafka-rest \
	-e KAFKA_REST_BOOTSTRAP_SERVERS=PLAINTEXT://kafka:9092 \
	-e KAFKA_REST_LISTENERS=http://0.0.0.0:8082 \
	-e "KAFKAREST_HEAP_OPTS=-Xms128m -Xmx256m" \
	--health-cmd "curl -sf http://localhost:8082/topics > /dev/null" \
	--health-interval 10s --health-timeout 5s --health-retries 12 --health-start-period 20s \
	confluentinc/cp-kafka-rest:7.9.0
wait_healthy nova-kafka-rest

# Next.js app + SQLite (./data/nova.db). The entrypoint runs schema/seed/migrations before the server starts.
docker run -d --name nova-app --network $NET --network-alias app --restart unless-stopped \
	--stop-timeout 20 \
	-p 3000:3000 \
	--env-file .env.local \
	-e PUBLIC_SITE_URL=http://localhost:3000 \
	-e DATABASE_PATH=/data/nova.db \
	-e MEDIA_DIR=/data/uploads \
	-e INTEGRATION_BUS=kafka \
	-e KAFKA_REST_URL=http://kafka-rest:8082 \
	-v "$PWD/data:/data" \
	nova-app:latest
wait_healthy nova-app

# Calls /api/cron/* on their intervals.
docker run -d --name nova-scheduler --network $NET --restart unless-stopped \
	--env-file .env.local \
	-e APP_URL=http://app:3000 \
	-e SKIP_DB_INIT=true \
	--no-healthcheck \
	nova-app:latest node scripts/scheduler.mjs

echo "up: http://localhost:3000  (kafka-rest: http://localhost:8082)"
