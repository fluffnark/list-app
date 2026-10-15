# Deployment boundaries

ListFlow is deployed through private Tailscale Serve on `https://harmony.great-kettle.ts.net:4443/listflow/`. It has no public Funnel entry. The backend binds 127.0.0.1:4318. At the owner’s explicit request, Caddy also proxies LAN HTTP on port 4443, binding only 192.168.1.44 and 192.168.1.253. LAN HTTP is unencrypted and serves the same authenticated app. The separate HTTPS origin prevents other Harmony browser apps from making authorized cross-origin API calls; unapproved origins receive 403.

Tailnet membership permits reaching the app shell. It does not grant access to synchronized data: API endpoints require an owner session, a scoped assistant token, or an explicitly generated owner-device token. The owner password and encryption key are random, stored mode 0600, and are not in Git. HTTPS session cookies are Secure; explicitly allowlisted LAN HTTP hosts receive non-Secure cookies. All session cookies are HttpOnly, SameSite=Strict, and scoped to /listflow. Session lifetime is 30 days; agent/device bearer-token lifetime is 90 days. Token creation/revocation and proposal approval require owner scope.

Rate limits apply to password login, OAuth endpoints, and APIs. JSON payload sizes and operation batch sizes are bounded. Security headers restrict scripts and network access to the app origin, deny framing and embedded objects, and disable referrer disclosure. Notes render as text/Markdown source rather than injected HTML. No third-party analytics or fonts are fetched.

Google authorization checks browser-bound state and an explicit verified owner email. Refresh credentials use authenticated encryption (AES-256-GCM). The full data/secret file is required to recover encrypted credentials from snapshots; it is not exported to Sheets.

MCP OAuth consent requires the workspace password, registered redirect URI, browser-bound nonce, S256 PKCE, resource binding, and a one-time authorization code. API actors come from the authenticated credential. Assistants cannot approve their own bulk/destructive proposals. Personal device tokens carry owner scope; never give those to assistants. Bearer tokens are secrets and should be revoked if exposed.

Browser-local working data is stored in IndexedDB; Android additionally keeps a SQLite checkpoint. This is private device storage, not application-level encryption. Use a locked, encrypted device and a personal browser profile. The app intentionally supports offline access; signing out of the server does not erase local notes or queued edits.

Production Android disallows mixed content. Its debug-only network configuration permits HTTP to loopback for isolated integration tests, and the test flag is unset in release artifacts. Android automatic backup is disabled. Inexact reminders contain the task title, so consider lock-screen notification privacy settings.

Nightly consistent snapshots retain 14 copies. Recovery and operation history are available; trash is not automatically purged. This file describes implemented controls and checked boundaries, not an independent security audit. Cloud-hosted ChatGPT cannot access this tailnet-only endpoint without a separate, explicitly approved network integration.
