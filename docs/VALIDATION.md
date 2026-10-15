# Actual validation — October 14, 2026

These are observed results, distinct from the proposed product specification. This is a working v0.2 implementation, not a claim that every long-duration release gate has passed.

| Check                              | Actual result                                                                                                                                                                                                                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript + Vite production build | Passed; installable PWA app-shell manifest and service worker generated.                                                                                                                                                                                                                                   |
| Vitest unit/integration suite      | 37 tests passed across model, mutation invariants, local IndexedDB/outbox, SQLite ledger, assistant policies, and mocked Sheets projection.                                                                                                                                                                |
| Playwright browser/API suite       | 7 tests passed: authorization, conflict merge/idempotency/approval, offline reload and hierarchy undo, mobile capture draft + Shopping, cross-device sync, note persistence, and OAuth discovery/consent/PKCE/code reuse/refresh revocation.                                                               |
| SQLite interrupted write           | Actual child process receives SIGKILL inside an uncommitted transaction; committed data and sequence survive, uncommitted data does not.                                                                                                                                                                   |
| Android debug build                | Passed on Java 21 / Android SDK 36 / AGP 8.13 / Gradle 8.14.5.                                                                                                                                                                                                                                             |
| Android signed release APK + AAB   | Built; APK verified with apksigner; AAB verified with jarsigner. App signing key stored outside the repository.                                                                                                                                                                                            |
| Android emulator                   | API 36 Google APIs x86_64 / Pixel 6: bundled launch, offline capture with Wi-Fi/data disabled, native SQLite outbox checkpoint, force-stop recovery, recovery after deliberately clearing the IndexedDB mirror, native text share, and Shopping deep link passed with Playwright’s Android WebView driver. |
| Android gateway integration        | Passed native token authentication/CORS, queued Android writes reaching the transactional gateway, and gateway edits reaching Android on the next sync. Loopback HTTP is enabled only for this debug test; release mixed content is disabled and production sync uses HTTPS.                               |
| Harmony service                    | ARM64 Node 24.22 runtime, SQLite WAL, systemd restart-on-failure and boot enablement; health check passed.                                                                                                                                                                                                 |
| Harmony HTTPS browser verification | Passed via SSH SOCKS route to the tailnet: production assets, owner login, capture, durable server sync, desktop/mobile screenshots, and OAuth metadata. Test capture then moved to Trash.                                                                                                                 |
| Backups                            | First consistent SQLite snapshot completed successfully; nightly timer enabled, retaining latest 14.                                                                                                                                                                                                       |
| Dependencies                       | `npm audit --omit=dev`: no vulnerabilities at verification time.                                                                                                                                                                                                                                           |

Run commands and reproduction details are in README and scripts/test-android.mjs / scripts/test-deployment.mjs. Browser tests use Playwright’s bundled Chromium; system Chromium may be selected with PLAYWRIGHT_CHROMIUM_EXECUTABLE. Screenshots in docs/screenshots contain synthetic test items.

## Pending external requirements

- Per the user's deployment decision, ListFlow is Tailscale-only on HTTPS port 4443. No public Funnel exposes it. Public internet ingress is intentionally unavailable. Cloud ChatGPT connectivity can be configured through an outbound Secure MCP Tunnel, but account setup and an end-to-end ChatGPT call are still pending. Existing 8443/10000 Funnel entries belong to other applications and were left in place; port 443 remains tailnet-only.
- Google OAuth needs a web OAuth client, client secret, allowlisted OWNER_EMAIL, enabled Sheets API, and owner consent. Google live-account login, token renewal, and projection have not been exercised. Sheets tests use mocked HTTP responses; no staging spreadsheet was available.
- ChatGPT/Codex connector installation remains an account-side step. The deployed MCP OAuth protocol passes local tests; no claim is made that this chat already has ListFlow tools.
- No physical Android device was connected. Seven-day offline endurance, real-device battery/launch/tap performance, OEM process death, actual reminder delivery, speech recognition, and Play Console upload are not claimed tested.
- Android reminders are inexact and do not yet re-arm after reboot. No guarantee of suspended-app background sync. Home-screen shortcuts are implemented; widgets are not.
- Google Sheets projection stops at its configured capacity; the visible operation log is bounded to the latest 10,000 operations. Full history remains in SQLite/backups. Automatic archive spreadsheet creation is not implemented.
- Full Obsidian bidirectional synchronization, household collaboration, push notifications, and AI-generated plans are outside this v0.1 implementation. The API provides deterministic reviewable day-plan proposals and controlled Markdown workflows.

## Early failures corrected

The first browser run used an exact Add-button name that included its keyboard hint; an explicit accessible label fixed the selector. An intermittent offline test matched the capture editor text before the local transaction had acknowledged completion; the test now waits for the committed task row and closed capture editor before reloading. Interrupted drafts remain recoverable. IndexedDB uses strict transaction durability, startup reads a snapshot before rendering, and SQLite uses FULL synchronous commits. The initial OAuth router limiter incorrectly applied to all traffic; it is now restricted to OAuth routes. Native device tokens and Android CORS/credential handling were corrected before release. No failing run is represented as passing in the table above.


## Mobile and notes-access update (v0.2.0)

Built mobile Home with direct note capture, recent notes, destination tiles, persistent Notes/Shopping navigation and larger controls. Desktop retains its layout and remembered view. Added assistant note-type query filtering and Markdown body capture, plus a portable notes skill and project context. Google Sheets remains a projection; direct spreadsheet edits are not imported.

Executed: TypeScript/Vite production build; 37 unit/integration tests passed; 7 Playwright tests passed, including mobile landing/capture/reload, 44px destination targets, 320px no-overflow, and switching back to the desktop view. Skill frontmatter validated with the skill-creator validator in an isolated Python environment. Signed Android APK/AAB versionCode 2 built successfully after a clean build resolved a Gradle incremental-resource cache failure.

No ChatGPT-account installation or live notes tool call is claimed. Harmony reports Google OAuth unconfigured. A private tunnel ID, restricted runtime key, and account-side custom MCP connection are still required. The instructions disclose that current OAuth read/write access covers the workspace, rather than enforcing notes-only permissions.

Android follow-up: emulator offline/SQLite recovery, share target and deep link checks passed. Native read/write gateway integration passed with a fresh disposable app state and debug-only HTTP test configuration; production Capacitor configuration was restored to `allowMixedContent: false`. Initial sync reruns reused a cursor from another temporary test database and failed; the integration test now resets app data only on an emulator and refuses physical-device resets.

Production follow-up: Harmony private HTTPS login, capture, durable sync, desktop/mobile rendering and OAuth discovery passed on v0.2.0. Tailscale Serve inspection confirmed no Funnel grant for ListFlow port 4443.


## Owner-requested LAN HTTP

Enabled `http://harmony.local:4443/` with a redirect to `/listflow/`, through a Caddy listener bound to Harmony’s two private IPv4 LAN addresses. The Tailscale listener on the same port continues to serve HTTPS. Added an exact LAN-origin allowlist and HTTP cookie handling; HTTPS cookies remain Secure. Added cryptographically random UUID fallback for non-secure browser contexts.

Executed production build, 38 unit/integration tests and 7 browser tests successfully. A production Chromium check through an SSH SOCKS route verified actual non-secure-context LAN launch, login, HTTP-only session cookie persistence, note capture, durable sync, reload, test-note cleanup, rejected unapproved origins, and Secure cookies on the HTTPS endpoint. The LAN test is `scripts/test-lan.mjs`. Public Funnel remains disabled for ListFlow. PWA service-worker/offline shell installation requires HTTPS; separate origins keep separate local working copies.


## Private MCP transport activation

After the owner saved the runtime key and requested continuation, verified mode-0600 credentials, tunnel metadata with organization/workspace association, successful local doctor checks, HTTP 200 OAuth metadata and the expected unauthenticated MCP 401. Started the client, checked managed runtime healthy/ready status, then moved it to a boot-enabled restart-on-failure systemd service. The systemd runtime returned 200 from loopback /healthz and /readyz and completed OAuth discovery. A ChatGPT-account tool round trip has not been performed. No model API calls, billing enablement, plan upgrades or credit purchases were made; tunnel transport pricing remains unverified.


## Tunnel OAuth audience fix

Observed ChatGPT registration succeed but authorization fail with `Invalid resource`: ChatGPT supplies its exact tunnel resource identifier instead of the original Tailscale MCP URL. Added an explicitly configured resource alias, retained it in grants, and enforced resource equality during token exchange. Also corrected the LAN HTTP consent nonce cookie and same-origin form action.

Production build passed; 39 unit/integration tests and 7 browser/API tests passed. New coverage completes LAN-origin consent and a PKCE token exchange with the tunnel audience, rejects another tunnel and a changed token audience, preserves Secure cookies for unapproved origins, and rejects authorization-code reuse. Production checks confirmed consent HTML and cookie mode on both HTTPS and LAN HTTP using the configured tunnel audience. A first diagnostic held a SQLite test-cleanup transaction across an HTTP request and failed due to its own write lock; rerunning with immediate cleanup commits passed.


## APK download in Settings

Moved the signed Android APK download from the bottom recovery controls into its own Android app card at the top of Settings. The link names the current v0.2.0 APK and includes a download filename. Production browser verification at a 390px mobile viewport confirmed the card/link is immediately visible and downloaded bytes match the signed release SHA-256. Production build passed.


## Browser form origin and callback correction

Reproduced the reported production `Origin denied` error with a real Chromium form submission: the consent page’s inherited `Referrer-Policy: no-referrer` caused `Origin: null`. The page now uses `strict-origin`, preserving origin checks while withholding authorization query details. A real browser regression also exposed CSP blocking the callback redirect; the consent page now allows only its validated callback origin in form-action. No global null-origin exception was added.

Production build, 39 unit/integration tests and 8 browser/API tests passed. The new browser test submits the password, observes an allowed Origin, follows a mocked callback and exchanges the authorization code successfully. A production check with a deliberately wrong diagnostic password confirmed that the LAN form now reaches password validation and that the callback CSP is scoped correctly. Actual ChatGPT-account consent remains user-driven; these tests do not claim its connection is complete.

## Tunnel readiness after deployment

Traced failed ChatGPT callbacks to an OAuth forwarding startup race: the gateway restart briefly returned 502, tunnel startup cached failed OAuth discovery, and later code-exchange requests failed with unsupported `harpoon` channel. Password approval and callback generation had succeeded, but no tokens were exchanged. Added a metadata availability probe before tunnel start, a post-start readiness guard requiring OAuth forwarding routes, and PartOf restart propagation from the gateway. Deployments now install these guards and verify forwarding readiness before reporting success. A controlled gateway restart and a complete deployment both returned ready=true, OAuth status ok and seven forwarding routes. Feature work on reminders and agent queues remains paused at the user's request; no such feature edits were made.

## MCP discovery after successful OAuth

Confirmed the real ChatGPT flow issued a read/write OAuth credential and then failed tool discovery because a valid JSON-RPC request ID of zero was treated as a notification. Missing IDs now identify notifications; ID zero returns a normal JSON result. Notifications return an empty 202 body. Production build and 9 browser/API tests passed, including new ID-zero initialization/tool-list coverage. A production authenticated probe passed initialization, tool listing and notification acknowledgment. OAuth readiness also passed after deployment. ChatGPT-side tool use remains pending user retry.

## v0.3.0 rich notes and category icons

Production build and 40 unit/integration tests passed. All 11 Playwright browser/API tests passed, including authenticated/idempotent/immutable image uploads, SVG and read-only-write rejection, complete export, MCP image responses, cross-device image retrieval, Markdown link/HTML safety, offline note/image/drawing recovery, ZIP download, category emoji/custom-image persistence, and mobile overflow checks. One earlier browser run raced a simultaneous Vite rebuild and could not load the initial bundle; the complete suite passed with a stable build. The category reload test was corrected to navigate from the intended mobile Home landing before asserting its management controls.

Signed v0.3.0 APK/AAB builds succeeded and APK signature verification passed. API 36 emulator tests passed bundled launch, offline capture, native SQLite checkpoint, force-stop recovery, Markdown/drawing restoration after deliberately clearing IndexedDB, native share target and Shopping deep link. Physical devices, large image library performance, endurance, and live Google Sheets remain untested.

Production v0.3.0 verification passed owner login, exact APK download SHA-256, authenticated image upload, live Markdown/image rendering, offline image reload, and MCP tool discovery with request ID zero including get_attachment. The synthetic test note was moved to Trash and its owner session revoked. Both gateway and tunnel readiness passed after deployment. Actual ChatGPT account discovery still requires a client refresh/retry; server-side probes do not establish account-side success.

## v0.4.0 themes

Executed production build, 41 unit/integration tests and all 12 Playwright browser/API tests successfully. Palette validation covers unique stable IDs, all 192 palettes, valid color values and text/accent-button contrast calculations. Browser coverage verifies Catppuccin, Dracula and Tycho application, mobile 320px light-theme overflow, offline persistence, empty search, keyboard selection, cross-tab updates and unknown-ID fallback. Inspected mobile Tycho, Catppuccin Latte and native Android screenshots.

Signed APK/AAB builds and APK signature verification passed. Android API 36 emulator verified Tycho survives force-stop/relaunch alongside offline capture, SQLite restoration after IndexedDB deletion, drawings, sharing and deep links. The first installation attempt was made while the emulator was still booting; installation and the complete device test passed once boot completed. Physical-device appearance/performance is not claimed tested.

Harmony v0.4.0 deployment passed owner login, persistent Tycho selection including offline reload, exact APK SHA-256, authenticated image upload/rendering, Markdown and MCP request-ID-zero discovery. The synthetic note was moved to Trash and its test session revoked. Gateway/tunnel readiness passed after deployment.

## v0.4.1 separate note title/content

Production build, 42 unit/integration tests and all 14 browser/API tests passed. New coverage validates multiline note-prefix capture, literal date/shopping prose, preservation of long first lines, separate title/content draft recovery offline, content Enter behavior, Ctrl+Enter save and body-only notes. The standard MCP SDK completes initialize/listTools/ping and a recoverable tool error against staging. A production SDK probe also passed discovery of all 13 tools and ping without reading note content; its temporary owner session was revoked.

Signed APK/AAB build and APK signature verification passed. Android API 36 emulator passed separate title/content capture and correct stored fields, theme persistence, offline capture, SQLite recovery, drawing recovery, sharing and deep links. Native note-capture screenshot was inspected. Physical-device testing is still outstanding.

Harmony v0.4.1 verification passed actual separate-field note capture through the UI and durable sync, exact stored title/content after reload, offline image rendering, Tycho persistence, APK checksum and ID-zero tool discovery. The synthetic note was moved to Trash and its session revoked. The v0.4.1 standard SDK production probe again passed all 13 tool schemas and ping. Tunnel/gateway readiness passed. This does not claim a successful ChatGPT account connection; a fresh ChatGPT refresh/retry remains pending.
