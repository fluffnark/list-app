#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
APP_BASE=/listflow/ npm run build
npm run build:server
mkdir -p dist/downloads
cp releases/listflow-v0.2.0.apk releases/listflow-v0.2.0.aab dist/downloads/
sha256sum releases/listflow-v0.2.0.apk releases/listflow-v0.2.0.aab > releases/SHA256SUMS
cp releases/SHA256SUMS dist/downloads/
cp integrations/chatgpt/skills/listflow-notes/SKILL.md dist/downloads/listflow-notes-SKILL.md
cp integrations/chatgpt/CONTEXT.txt dist/downloads/listflow-chatgpt-context.txt
(cd integrations/chatgpt && zip -qr ../../dist/downloads/listflow-notes-plugin.zip plugin.json skills CONTEXT.txt)
# Keep deployment artifact separate from local-only data and Android keys.
tar -czf /tmp/listflow-deploy.tar.gz dist server-dist package.json scripts/backup.mjs
ssh -F "$HOME/.ssh/config" harmony 'mkdir -p ~/repos/listflow/releases ~/repos/listflow/data'
scp -F "$HOME/.ssh/config" /tmp/listflow-deploy.tar.gz harmony:/tmp/listflow-deploy.tar.gz
ssh -F "$HOME/.ssh/config" harmony 'set -eu; target="$HOME/repos/listflow/releases/$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "$target"; tar -xzf /tmp/listflow-deploy.tar.gz -C "$target"; ln -sfn "$target" "$HOME/repos/listflow/current"; sudo -n systemctl restart listflow; sleep 2; curl -fsS http://127.0.0.1:4318/listflow/api/health'
