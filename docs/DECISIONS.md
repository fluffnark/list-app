# Decision log

2026-10-14: User authorized implementation, testing, and deployment with no hosting budget; Harmony Raspberry Pi approved as persistent host. Single-owner workspace, private data, React/TypeScript local-first PWA, Capacitor Android, transactional SQLite operation ledger, Sheets as optional readable projection.

- Existing Harmony services must remain intact. Deploy at `/listflow/` on a dedicated Tailscale-only HTTPS origin, `https://harmony.great-kettle.ts.net:4443`. The user explicitly requested tailnet-only deployment before any public Funnel exposure. ListFlow routes were removed from the shared 443 origin to isolate browser access from neighboring apps.
- Google web OAuth needs new web-client credentials; the neighboring car-dashboard uses phone-only Google Tasks authorization, not a transferable web login. Until configured, owner password authenticates sync. Password is generated on Harmony and stored mode 0600, never in the repository. Google owner email is explicitly allowlisted.
- OAuth requests `openid email drive.file`. Only the spreadsheet the application creates is projected. No Drive-wide access, vault contents, or passwords in Sheets.
- Browser state and outbox use one IndexedDB transaction. Android additionally commits a native SQLite checkpoint before acknowledging local changes, restoring it into IndexedDB on cold launch. This uses a custom Capacitor bridge rather than an unvalidated external SQLite plugin. API 36 emulator testing verifies SQLite checkpoint persistence, force-stop recovery, and recovery after erasing the IndexedDB mirror; physical-device validation remains required.
- Recurrence uses an explicit daily/weekly/monthly subset with interval and IANA timezone. One persistent item stores the latest completion and next due date; audit contains prior completions. Missed periods skip forward; no backlog. Monthly dates clamp using Luxon calendar semantics.
- Pure containers auto-complete; independent parents require explicit completion. Nested tasks share the parent list. Moving a root moves its subtree atomically. Delete/restore uses a deletion-batch ID so previously deleted children stay deleted.
- Trash is retained indefinitely pending a chosen retention window; no automatic permanent purge. Operation history retained indefinitely in this release. Nightly SQLite snapshots retain 14 copies; Google tokens stay encrypted in SQLite and key stays outside snapshots, so full disaster recovery also requires the data/secret file.
- Assistant bearer tokens have read or read/write scope and a 90-day lifetime. Bulk/destructive proposals require approval in the owner UI. JSON-RPC MCP and OpenAPI endpoints are deployed; connecting ChatGPT/Codex remains dependent on client/account connector support. OAuth MCP discovery, dynamic registration, PKCE, consent, and token renewal are implemented and protocol-tested; this is not a claim of an installed ChatGPT connector.
- Android includes native text share target, app shortcuts, speech recognizer handoff, and opt-in inexact notifications. Reminder alarms do not currently survive a phone reboot; no guaranteed background sync. Foreground/open/connectivity sync plus durable offline capture are implemented. Play publishing requires a developer account and is not claimed.
- Voice recognition uses the device's installed speech service only after explicit tap; availability and offline behavior depend on that service.
- Obsidian exports carry stable IDs and URI links; Markdown import creates a new note, avoiding unsafe implicit bidirectional merges.
- No performance timings, multi-day offline endurance, Sheets live-account behavior, or Android lifecycle reliability are claimed without executing the corresponding tests.


## 2026-10-14 — Mobile landing and ChatGPT notes

Mobile launches into notes/navigation regardless of the previous route; desktop keeps its remembered route. Mobile Home and Notes replace Today/Inbox in bottom navigation, while destination tiles retain direct access. Global capture remains general-purpose; dedicated note capture sets the note type.

Use the existing operations API for live assistant writes. Google Sheets cell edits are not an import protocol. Prefer the account-supported outbound OpenAI MCP tunnel to public ingress; activation remains pending account credentials/association. A skill supplies workflow context and does not create a connection or enforce a narrower authorization scope.


## 2026-10-14 — Explicit LAN HTTP opt-in and tunnel cost constraint

Owner requested LAN HTTP in addition to private HTTPS. Caddy binds port 4443 on the two LAN IPv4 addresses, redirects root to /listflow/, and proxies the loopback backend. Only explicit LAN origins receive non-Secure session cookies; HTTPS sessions retain Secure. Plain HTTP does not support installable/offline service-worker caching, and browser data remains isolated by origin.

Owner supplied a private MCP tunnel ID and required zero additional cost. Installed and configured the local client without activating it. Public docs do not provide an explicit free-price guarantee; runtime activation and billing/account checks remain pending rather than assuming absence of a listed price means free.

## Rich notes and category icons

Categories accept emoji or authenticated uploaded raster icons. Notes render CommonMark plus GitHub-flavored Markdown (tables, checklists, strikethrough and fenced code), with escaped raw HTML and sanitized links. Editing, clipboard images, drawing with undo, and portable Markdown/image ZIP export share the local-first model. Note content appears immediately under the title before task properties on mobile and desktop.

Image bytes live in the local database metadata/checkpoint and the gateway SQLite attachment table, with immutable UUIDs and SHA-256 retry checks. Uploads precede dependent entity operations; Markdown and Sheets contain attachment references rather than base64. Images require authenticated read access, write scope for upload, raster format checks and a 1 MiB server limit; larger imports are resized client-side. SVG is excluded. Cached attachments work offline; another device must first retrieve an attachment online. Attachments currently follow indefinite retention alongside the workspace; no automatic garbage collection or destructive purge. Native checkpoint size grows with cached images and physical-device performance is still unmeasured.

## v0.4.0 appearance

Added Settings → Appearance with a bundled snapshot of 192 palettes: the existing ListFlow default, Omarchy stock and community palettes, and the original Tycho palette. Community JSON/TOML is treated as data only; no theme configuration, scripts or wallpapers are installed. Attribution links point to each upstream repository. Theme search, light/dark filtering and keyboard selection run entirely offline. Selection is a per-device localStorage preference with live cross-tab updates; it does not mutate workspace records. Unknown IDs fall back to ListFlow. Semantic CSS tokens cover UI surfaces, text, accents and status colors, with derived text/button contrast adjustments. Images and the white drawing canvas preserve their content colors. Shipped as web and signed Android v0.4.0, with older APK downloads retained.
