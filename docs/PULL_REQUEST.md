Title: Build ListFlow web and Android workspace with private sync and rich notes

ListFlow captures tasks, shopping items and notes locally, preserves nested subtasks and deletion recovery, advances recurring routines without backlog, and synchronizes devices through an authenticated SQLite operation ledger. The React PWA and signed Capacitor Android app now include mobile notes/navigation launch, category emoji or uploaded icons, Markdown preview, authenticated image attachments, doodles, and portable Markdown/image export. Notes open directly into their content above task properties.

Harmony serves private Tailscale HTTPS plus explicitly enabled LAN HTTP. A persistent outbound MCP tunnel keeps public ingress disabled. OAuth validates the exact tunnel audience, supports browser consent and PKCE, waits for forwarding readiness after restarts, and correctly accepts JSON-RPC request ID zero during ChatGPT discovery. Google OAuth/Sheets code remains unconfigured pending owner credentials; actual ChatGPT account-side discovery requires a refresh/retry.

Validation: production build; 40 unit/integration tests; 11 Playwright browser/API tests; signed v0.3.0 APK/AAB builds and APK signature verification; Android API 36 emulator offline, force-stop, native SQLite and Markdown/drawing restoration after IndexedDB deletion; production login, APK checksum, image upload, Markdown render, offline image reload and MCP discovery. Details and remaining gates are in docs/VALIDATION.md. Physical-device endurance and live Google-account tests remain outstanding. Reminder expansion and assistant task queue remain paused.

GitHub CLI authentication is unavailable; the branch is pushed, but a PR has not been opened.
