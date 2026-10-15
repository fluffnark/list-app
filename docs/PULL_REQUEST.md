Title: Build ListFlow local-first web and Android workspace with private Harmony deployment

ListFlow now captures tasks, shopping items, and notes locally, preserves nested subtasks and deletion recovery, advances recurring routines without missed-period backlog, and synchronizes devices through an authenticated SQLite operation ledger. The React PWA and signed Capacitor Android app share mutation rules, durable operation IDs, conflict preservation, and explicit assistant approval boundaries.

Deployment is Tailscale-only on Harmony's dedicated HTTPS port 4443. Google web OAuth and Sheets projection are implemented but remain unconfigured pending an owner OAuth client. MCP supports scoped bearer access and a tested OAuth consent/PKCE flow; cloud ChatGPT cannot reach the private tailnet endpoint.

Validation: 36 unit/integration tests, 6 Playwright browser/API tests, successful signed APK/AAB builds, Android emulator offline/force-stop/SQLite-mirror recovery/share/deep-link checks, native gateway sync, and production HTTPS login/capture/sync checks through the tailnet. Full results and remaining release gates are in docs/VALIDATION.md.

The implementation is split into schema/invariants, gateway/auth, UI/sync, and Android/deployment commits. GitHub CLI authentication was unavailable in this environment; a PR must be opened from the pushed branch using GitHub.
