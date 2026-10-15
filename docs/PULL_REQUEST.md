Title: Build ListFlow web and Android workspace with private sync, rich notes and themes

ListFlow captures tasks, shopping items and notes locally, preserves nested subtasks and deletion recovery, advances recurring routines without backlog, and synchronizes devices through an authenticated SQLite operation ledger. The shared React PWA and signed Capacitor Android app include mobile notes/navigation launch, category icons, Markdown preview, image attachments, doodles and portable export. Settings now offers 192 offline themes, including Catppuccin, Dracula, Tycho and Omarchy community palettes, with search, light/dark filtering and per-device persistence. Dedicated note capture separates Title and Content, preserves both drafts offline, and supports multiline entry.

Harmony serves private Tailscale HTTPS plus explicitly enabled LAN HTTP. A persistent outbound MCP tunnel keeps public ingress disabled. OAuth validates the tunnel audience, supports browser consent and PKCE, waits for forwarding readiness, and accepts request ID zero during discovery. Google OAuth/Sheets remains unconfigured pending owner credentials; actual ChatGPT account-side discovery still needs client confirmation.

Validation: production build, 42 unit/integration tests, 14 browser/API tests, signed v0.4.1 APK/AAB and signature verification, Android API 36 emulator offline/recovery/theme-persistence checks, and production login/theme/APK/image/MCP verification. Full results and remaining gates are in docs/VALIDATION.md. Physical-device endurance and live Google-account tests remain outstanding. Reminder expansion and the assistant task queue remain paused.

GitHub CLI authentication is unavailable; the branch is pushed, but a PR has not been opened.
