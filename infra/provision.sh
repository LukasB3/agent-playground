#!/usr/bin/env bash
# One-time (and re-runnable) host setup for a fresh Ubuntu 24.04 server.
# Usage: sudo API_DOMAIN=api.playground.example WEB_ORIGIN=https://playground.example ./provision.sh
set -euo pipefail

: "${API_DOMAIN:?set API_DOMAIN}" "${WEB_ORIGIN:?set WEB_ORIGIN}"
[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }
here=$(cd "$(dirname "$0")" && pwd)
etc=/etc/agent-playground
data=/var/lib/agent-playground
export DEBIAN_FRONTEND=noninteractive

echo "== packages"
apt-get update -q
apt-get -y -q full-upgrade
apt-get -y -q install ca-certificates curl git ufw unattended-upgrades docker.io docker-compose-v2 docker-buildx caddy
if ! node --version 2>/dev/null | grep -q '^v22\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get -y -q install nodejs
fi
systemctl enable --now docker unattended-upgrades

echo "== firewall"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443
ufw --force enable

echo "== service user and directories"
id -u playground &>/dev/null || useradd --system --home-dir "$data" --shell /usr/sbin/nologin playground
# The orchestrator must not reach the Docker socket; it gets the launcher below instead.
gpasswd --delete playground docker &>/dev/null || true
install -d -o playground -g playground -m 750 "$data"
install -d -o root -g playground -m 750 "$etc"

echo "== secrets"
random() { head -c 32 /dev/urandom | base64 | tr -d '=+/'; }
if [[ ! -f $etc/orchestrator.env ]]; then
  signing=$(random)
  install -o root -g playground -m 640 /dev/null "$etc/orchestrator.env"
  cat > "$etc/orchestrator.env" <<EOF
WEB_ORIGIN=$WEB_ORIGIN
TURNSTILE_SECRET=REPLACE_ME
IP_HASH_SECRET=$(random)
PROXY_SIGNING_SECRET=$signing
EOF
  # The real API key lives only here, readable by root and passed to the proxy container.
  install -o root -g root -m 600 /dev/null "$etc/proxy.env"
  cat > "$etc/proxy.env" <<EOF
ANTHROPIC_API_KEY=REPLACE_ME
PROXY_SIGNING_SECRET=$signing
EOF
fi

echo "== deploy key for the apps repository"
if [[ ! -f $etc/deploy_key ]]; then
  ssh-keygen -q -t ed25519 -N '' -C 'agent-playground deploy key' -f "$etc/deploy_key"
  chown playground:playground "$etc/deploy_key" "$etc/deploy_key.pub"
  chmod 600 "$etc/deploy_key"
fi
install -o root -g root -m 644 "$here/github_known_hosts" "$etc/known_hosts"

echo "== sandbox launcher"
install -o root -g root -m 755 "$here/pg-sandbox" /usr/local/sbin/pg-sandbox
install -o root -g root -m 644 "$here/sandbox.conf" "$etc/sandbox.conf"
install -o root -g root -m 440 "$here/sudoers" /etc/sudoers.d/agent-playground
visudo -cf /etc/sudoers.d/agent-playground

echo "== caddy"
sed "s/{{API_DOMAIN}}/$API_DOMAIN/" "$here/Caddyfile" > /etc/caddy/Caddyfile
systemctl enable caddy
systemctl reload caddy || systemctl restart caddy

echo "== systemd unit"
install -o root -g root -m 644 "$here/agent-playground.service" /etc/systemd/system/agent-playground.service
systemctl daemon-reload
systemctl enable agent-playground

echo
echo "Done. Deploy key to add to the apps repository (write access):"
cat "$etc/deploy_key.pub"
[[ -f /var/run/reboot-required ]] && echo "A reboot is required to finish the updates."
exit 0
