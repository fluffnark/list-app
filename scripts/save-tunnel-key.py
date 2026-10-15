#!/usr/bin/env python3
"""Save a tunnel-only runtime credential locally without echoing or activating it."""
import getpass
import os
from pathlib import Path
import secrets
import sys

if not sys.stdin.isatty():
    raise SystemExit("Run this interactively in a terminal; key input must be hidden.")

key = getpass.getpass("OpenAI tunnel runtime key (hidden): ").strip()
if not key.startswith("sk-") or any(char.isspace() for char in key):
    raise SystemExit("Expected a single OpenAI API key; nothing saved.")

directory = Path.home() / ".config" / "tunnel-client"
directory.mkdir(parents=True, exist_ok=True, mode=0o700)
directory.chmod(0o700)
target = directory / "listflow-runtime-key"
if target.is_symlink():
    raise SystemExit("Refusing to replace a symlink; nothing saved.")
temporary = directory / (".listflow-key-" + secrets.token_hex(8))
try:
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        handle.write(key + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(target)
finally:
    temporary.unlink(missing_ok=True)

print("Saved the runtime key privately (mode 0600). The tunnel remains stopped.")
