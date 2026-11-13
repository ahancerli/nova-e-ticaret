#!/bin/sh
# One-time preparation of a fresh Ubuntu / Debian server (run as root):
#   scp deploy/server-setup.sh root@SERVER_IP:/root/ && ssh root@SERVER_IP sh /root/server-setup.sh
# Installs Docker Engine + Compose plugin, opens only SSH / HTTP / HTTPS, adds 2 GB swap when the server has none
# (next build needs memory), and creates the app directory /opt/nova. Safe to run again.
set -eu

APP_DIR="${APP_DIR:-/opt/nova}"

if ! command -v docker >/dev/null 2>&1; then
	echo "→ installing Docker"
	apt-get update -y
	apt-get install -y ca-certificates curl
	curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker
docker compose version

if ! command -v rsync >/dev/null 2>&1; then
	apt-get install -y rsync
fi

if command -v ufw >/dev/null 2>&1 || apt-get install -y ufw; then
	echo "→ firewall: SSH, HTTP, HTTPS"
	ufw allow OpenSSH
	ufw allow 80/tcp
	ufw allow 443/tcp
	ufw allow 443/udp
	ufw --force enable
fi

if [ "$(swapon --show | wc -l)" -eq 0 ]; then
	echo "→ adding 2 GB swap"
	fallocate -l 2G /swapfile
	chmod 600 /swapfile
	mkswap /swapfile
	swapon /swapfile
	grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

mkdir -p "$APP_DIR"
echo "✓ server ready — app directory: $APP_DIR"
