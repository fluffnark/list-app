#!/usr/bin/env python3
"""Fail service startup if private OAuth forwarding did not become ready."""
import json
from pathlib import Path
import time
import urllib.request

deadline = time.monotonic() + 30
while time.monotonic() < deadline:
    try:
        address = (Path.home() / ".local/state/tunnel-client/health/listflow.url").read_text().strip()
        with urllib.request.urlopen(address + "/health?details=true", timeout=2) as response:
            health = json.load(response)
        parts = health.get("components", {})
        if (
            health.get("ready")
            and parts.get("oauth", {}).get("status") == "ok"
            and parts.get("harpoon", {}).get("details", {}).get("target_count", 0) > 0
        ):
            print("Private MCP transport and OAuth forwarding ready.")
            break
    except (OSError, ValueError):
        pass
    time.sleep(0.5)
else:
    raise SystemExit("Tunnel OAuth forwarding did not become ready; restart required.")
