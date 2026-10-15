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
tar -czf /tmp/listflow-deploy.tar.gz dist server-dist package.json scripts/backup.mjs scripts/wait-tunnel-ready.py deploy/listflow-tunnel.service
ssh -F "$HOME/.ssh/config" harmony 'mkdir -p ~/repos/listflow/releases ~/repos/listflow/data'
scp -F "$HOME/.ssh/config" /tmp/listflow-deploy.tar.gz harmony:/tmp/listflow-deploy.tar.gz
ssh -F "$HOME/.ssh/config" harmony 'bash -s' <<'REMOTE'
set -euo pipefail
target="$HOME/repos/listflow/releases/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$target"
tar -xzf /tmp/listflow-deploy.tar.gz -C "$target"
if systemctl is-enabled --quiet listflow-tunnel.service 2>/dev/null; then
  install -m 700 "$target/scripts/wait-tunnel-ready.py" "$HOME/.local/share/listflow-tunnel/wait-ready.py"
  sudo -n install -m 644 "$target/deploy/listflow-tunnel.service" /etc/systemd/system/listflow-tunnel.service
  sudo -n systemctl daemon-reload
fi
ln -sfn "$target" "$HOME/repos/listflow/current"
sudo -n systemctl restart listflow
curl --fail --silent --show-error --retry 20 --retry-all-errors --retry-delay 1 --max-time 3 http://127.0.0.1:4318/listflow/api/health
if systemctl is-enabled --quiet listflow-tunnel.service 2>/dev/null; then
  sudo -n systemctl start listflow-tunnel.service
  python3 "$HOME/.local/share/listflow-tunnel/wait-ready.py"
fi
REMOTE
