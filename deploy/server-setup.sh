#!/bin/sh
# One-time preparation of a fresh Ubuntu / Debian server (run as root, or with sudo as the cloud user):
#   scp deploy/server-setup.sh root@SERVER_IP:/root/ && ssh root@SERVER_IP sh /root/server-setup.sh
#   Oracle Cloud / other images with a default `ubuntu` user:
#   scp deploy/server-setup.sh ubuntu@SERVER_IP:~ && ssh ubuntu@SERVER_IP sudo sh server-setup.sh
# Installs Docker Engine + Compose plugin, opens only SSH / HTTP / HTTPS, adds swap when the server has none
# (next build needs memory), and creates the app directory /opt/nova. Safe to run again.
# When run through sudo, the calling user joins the docker group and owns /opt/nova, so `npm run deploy` works
# with DEPLOY_HOST=ubuntu@SERVER_IP (no root login needed).
set -eu

APP_DIR="${APP_DIR:-/opt/nova}"
SWAP_SIZE="${SWAP_SIZE:-2G}"
DEPLOY_USER="${SUDO_USER:-}"

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

# Oracle Cloud images ship their own iptables rules (/etc/iptables/rules.v4, ending in a REJECT) and must not get
# ufw on top (Oracle warns it can break the instance's boot-volume / metadata traffic). Open the ports there instead.
# Remember: Oracle also needs ingress rules for 80/tcp, 443/tcp, 443/udp in the VCN Security List.
if [ -f /etc/iptables/rules.v4 ] && grep -q 'REJECT' /etc/iptables/rules.v4; then
	echo "→ firewall (iptables / netfilter-persistent): HTTP, HTTPS"
	for rule in "-p tcp --dport 80" "-p tcp --dport 443" "-p udp --dport 443"; do
		# shellcheck disable=SC2086
		iptables -C INPUT $rule -m state --state NEW -j ACCEPT 2>/dev/null \
			|| iptables -I INPUT 5 $rule -m state --state NEW -j ACCEPT
	done
	netfilter-persistent save
elif command -v ufw >/dev/null 2>&1 || apt-get install -y ufw; then
	echo "→ firewall (ufw): SSH, HTTP, HTTPS"
	ufw allow OpenSSH
	ufw allow 80/tcp
	ufw allow 443/tcp
	ufw allow 443/udp
	ufw --force enable
fi

if [ "$(swapon --show | wc -l)" -eq 0 ]; then
	echo "→ adding ${SWAP_SIZE} swap"
	fallocate -l "$SWAP_SIZE" /swapfile
	chmod 600 /swapfile
	mkswap /swapfile
	swapon /swapfile
	grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

mkdir -p "$APP_DIR"
if [ -n "$DEPLOY_USER" ] && [ "$DEPLOY_USER" != "root" ]; then
	echo "→ deploy user ${DEPLOY_USER}: docker group + owner of ${APP_DIR}"
	usermod -aG docker "$DEPLOY_USER"
	chown "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"
fi
echo "✓ server ready — app directory: $APP_DIR"
