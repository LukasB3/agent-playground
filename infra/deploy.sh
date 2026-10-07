#!/usr/bin/env bash
# Builds and (re)starts everything from a checkout in /opt/app-generator.
# Usage: sudo ./deploy.sh [git-ref]
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }
repo=/opt/app-generator
ref=${1:-main}

if [[ ! -d $repo/.git ]]; then
  git clone --quiet https://github.com/LukasB3/app-generator.git "$repo"
fi
git -C "$repo" fetch --quiet origin
git -C "$repo" checkout --quiet --detach "origin/$ref"

cd "$repo/orchestrator"
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm prune --omit=dev --no-audit --no-fund

cd "$repo/infra"
docker compose --profile build build --quiet
docker compose up --detach proxy

systemctl restart app-generator
sleep 2
systemctl --no-pager --lines=5 status app-generator
curl -fsS http://127.0.0.1:8787/api/health && echo
