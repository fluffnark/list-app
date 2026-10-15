#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
APP_BASE=/listflow/ npm run build
npm run build:server
mkdir -p dist/downloads
cp releases/listflow-v0.1.0.apk releases/listflow-v0.1.0.aab dist/downloads/
sha256sum releases/listflow-v0.1.0.apk releases/listflow-v0.1.0.aab > releases/SHA256SUMS
cp releases/SHA256SUMS dist/downloads/
# Keep deployment artifact separate from local-only data and Android keys.
tar -czf /tmp/listflow-deploy.tar.gz dist server-dist package.json scripts/backup.mjs
ssh -F "$HOME/.ssh/config" harmony 'mkdir -p ~/repos/listflow/releases ~/repos/listflow/data'
scp -F "$HOME/.ssh/config" /tmp/listflow-deploy.tar.gz harmony:/tmp/listflow-deploy.tar.gz
ssh -F "$HOME/.ssh/config" harmony 'set -eu; target="$HOME/repos/listflow/releases/$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "$target"; tar -xzf /tmp/listflow-deploy.tar.gz -C "$target"; ln -sfn "$target" "$HOME/repos/listflow/current"; sudo -n systemctl restart listflow; sleep 2; curl -fsS http://127.0.0.1:4318/listflow/api/health'
