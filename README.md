# ListFlow

A local-first personal workspace for tasks, shopping, nested subtasks, notes, repeat routines, and a deliberately small Today view. React + TypeScript PWA and installable Capacitor Android app; authenticated Node/SQLite sync service on Harmony. No paid hosting service is required.

## Run

Requires Node 24.22+ (built-in SQLite).

```sh
npm ci
npm run build
npm run server
```

Open http://localhost:4318. Capture works immediately without an account. For development, run `npm run dev` alongside the server.

The server generates a workspace password at `data/admin-password` on first launch. Read it locally and enter it in **Settings & connections → Your workspace**. Keep the file private. All synchronized data belongs to one explicitly authorized owner; this release has no household/multiuser sharing.

## Deployed web app

https://harmony.great-kettle.ts.net:4443/listflow/

The service offers private Tailscale HTTPS on port 4443 and, by explicit owner request, LAN HTTP at `http://harmony.local:4443/` (redirects to `/listflow/`). Public Funnel is disabled for ListFlow. The LAN proxy binds only `192.168.1.44` and `192.168.1.253`; its Caddy snippet is in `deploy/listflow-lan.caddy`. Update these bindings and `LAN_HTTP_ORIGINS` if DHCP addresses change. HTTP traffic is unencrypted; use Tailscale HTTPS for encrypted access and installable/offline PWA support. Browser storage is separate for each origin, so sign in and sync before switching between them.

Retrieve the owner password without placing it in Git:

```sh
ssh harmony 'cat ~/repos/listflow/data/admin-password'
```

The web shell is public; all synchronized user data, search, exports, and assistant tools require authentication. Local captures work offline and join the private workspace after sign-in. Do not use the owner session on a shared browser profile.

## Android

Signed artifacts are in `releases/`; the deployment also serves `/listflow/downloads/listflow-v<version>.apk`. Install the APK directly; the AAB is for a future Play Console upload. The Android app bundles the web interface, so local capture does not require Harmony to be reachable. It uses a native SQLite checkpoint with IndexedDB as a UI mirror, a native text-share target, quick-capture/shopping shortcuts, speech-recognizer handoff, and optional inexact reminders.

For cross-device sync:

1. Sign into the web app.
2. In Settings → Assistant access, create a **Personal Android device** token. This grants full owner access; do not give this token to an assistant.
3. On Android, Settings → Device & connection: set the sync URL to `https://harmony.great-kettle.ts.net:4443/listflow`, paste the token, and save.

Signed release builds (including from another machine) follow `docs/ANDROID-BUILD.md`. Build with Java 21 and Android SDK 36:

```sh
npm run android:sync
cd android
./gradlew :app:assembleDebug
```

The isolated native sync test uses `LISTFLOW_ALLOW_TEST_HTTP=1` at Capacitor sync time plus a debug-only network rule allowing loopback HTTP; never set that flag for a release. Run `npm run build`, `LISTFLOW_ALLOW_TEST_HTTP=1 npx cap sync android`, build/install debug, then `npm run test:android-sync`. Restore with plain `npx cap sync android` before release builds.

Set `LISTFLOW_SIGNING_FILE` to an external Java properties file (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`) for signed `assembleRelease bundleRelease`. The generated signing key on this workstation is stored outside this repo at `~/.local/share/listflow-signing/`. Back up that directory privately; never commit it.

## Calendar and Google sign-in

Calendar has Day and Week timelines and a Month grid. Use the view buttons, previous/next, and Today; select a month date to open its day. Dated tasks stay visible alongside Google and ICS events. Select an event to read its full details. The chosen view is remembered on this device.

Settings → Calendars has a Google setup guide and owner-only client configuration form. Create a Google Cloud **web** OAuth client, enable the Calendar API, and add the exact callback URI:

`https://harmony.great-kettle.ts.net:4443/listflow/auth/google/callback`

Sign in to the workspace, enter the web client ID, client secret, and full owner Google email in Settings → Calendars, then select **Sign in with Google**. Credentials are encrypted in the server database and never returned by its configuration API. Alternatively, configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `OWNER_EMAIL` in `/etc/listflow.env` and restart `listflow.service`; saved Settings configuration takes precedence. Add your Google account as a test user if the consent screen is in testing. OAuth opens on the canonical HTTPS address, which must be reachable in that browser; LAN starts redirect there before setting the OAuth cookie. Enable the Sheets and Drive APIs too for the optional spreadsheet copy. Scopes are `openid email drive.file` plus `calendar.calendarlist.readonly` and `calendar.events` for Calendar; Drive access is limited to app-created files. Existing Android Google Tasks OAuth registrations are not reusable web clients.

Sheets is a read-only materialized copy. Edit through ListFlow or its APIs. External row changes stop projection and show an actionable error. Export manual edits before explicitly rebuilding. Full operation history stays in transactional SQLite. Live Google-account authorization is not claimed tested without credentials.

## Google Home task capture

Settings & connections → Google Home task capture imports open tasks from a selected Google Tasks list into ListFlow's Inbox. Say “Hey Google, remind me to…” to the Mini; enable Voice Match and Personal results on the speaker if prompted. The speaker and phone should use Palantir, not the isolated guest network.

Enable the Google Tasks API in the same Cloud project used for ListFlow's Google OAuth client, then choose **Allow Google Tasks access**. This adds the read-only `https://www.googleapis.com/auth/tasks.readonly` scope only when requested. Select the list receiving your voice tasks and enable capture; existing open tasks in that list are imported too. The server checks about once a minute, with **Import now** for a manual check. Capture is off by default.

This is a one-way capture integration: each task imports once. Subsequent edits, completions and deletions stay in the app where they were made. Removing a task in ListFlow does not cause it to reappear. Google exposes due dates but not reminder times, so timed alerts remain in Google Tasks. Imported items travel through ListFlow's normal operation ledger and cross-device sync. Without a configured OAuth client, owner consent and a live voice-task round trip, only the implementation is verified—not the account connection.

## Assistant API and chat clients

Settings can issue scoped 90-day assistant tokens. Use a **read-only** token unless writing is needed.

- Streamable HTTP JSON-RPC MCP: `https://harmony.great-kettle.ts.net:4443/listflow/mcp`
- OpenAPI: `https://harmony.great-kettle.ts.net:4443/listflow/openapi.json`
- REST: `/api/agent/<tool_name>`

OAuth discovery/consent/PKCE is available for compatible remote MCP clients; scoped bearer tokens are also supported. See [assistant connection details](docs/ASSISTANTS.md).

Bearer authentication is required for API calls. Tools support stable IDs and idempotency UUIDs. Bulk/destructive changes are proposals that only the owner can approve in the UI. Daily planning returns a reviewable proposal without editing commitments. A working endpoint does not imply that ChatGPT or Codex has been connected; client/account connector support and configuration remain necessary.

Example MCP client configuration:

```json
{
  "mcpServers": {
    "listflow": {
      "url": "https://harmony.great-kettle.ts.net:4443/listflow/mcp",
      "headers": { "Authorization": "Bearer <scoped-assistant-token>" }
    }
  }
}
```

## Verification

```sh
npm test
npm run build
npm run test:e2e
npm run build:server
```

See [actual validation results](docs/VALIDATION.md) and [decisions and deviations](docs/DECISIONS.md). Acceptance criteria in the original design are requirements, not claims that long-duration physical-device, Google-account, or load tests have passed.

## Deployment and recovery

`scripts/deploy-harmony.sh` builds a `/listflow/` web bundle and bundled server, uploads a release, updates the `current` symlink, and restarts the existing service. It preserves `data/` across releases. Harmony uses a dedicated Node runtime at `~/repos/listflow/runtime/`; system Node and existing apps are untouched.

`listflow.service` restarts on failure and on boot. `listflow-backup.timer` takes nightly consistent SQLite snapshots and retains the latest 14. For a full backup, securely copy the entire `data/` directory, including `secret` (the encryption key) and the private password. Do not publish backups or Google refresh tokens.

To recover: stop the service, preserve current data, restore a snapshot as `data/listflow.sqlite`, remove obsolete SQLite WAL/SHM files while stopped, retain the matching `secret`, and start the service. Clients with a cursor newer than a restored snapshot need a device rebootstrap; export their pending changes first. A rollback to a prior application release should preserve the same schema and data directory.

Trash and audit are retained indefinitely in v0.1; the UI supports recovery and export, not permanent purge. Inexact Android reminder alarms currently need re-arming after reboot. Background sync is opportunistic and is not guaranteed while Android suspends the app.

## Notes and category icons

Notes have Edit/Preview modes with CommonMark and GitHub-flavored Markdown, including tables, checklists, links and code blocks. Add or paste images, draw with pen/color/undo controls, and export a ZIP containing Markdown and its images. Images and doodles are saved locally, then synchronized through authenticated attachment endpoints. Larger images are resized; the uploaded limit is 1 MiB per image. Cached images remain available offline. Raw HTML is displayed as text.

In All Lists, create a category with an emoji or use Upload icon for a custom PNG/JPEG/WebP. Icons synchronize with the category. Settings provides the signed Android download for the current version; older APK URLs remain available.

## Appearance

Settings → Appearance includes 192 offline themes: Catppuccin Mocha/Latte, Dracula, Tycho, Omarchy stock themes and community palettes. Search or filter light/dark, then tap a preview to apply. Your choice stays on this device and updates other open tabs. Select ListFlow to restore the original theme. [Palette sources and details](docs/THEMES.md).

Note capture uses separate optional Title and Markdown Content fields. Enter moves from the title into content and adds newlines in content; Ctrl/Cmd+Enter saves. Both drafts survive closing and offline reload. Generic quick capture also supports `note: Title` followed by multiline content, without interpreting note prose as dates or shopping instructions. Existing notes are preserved.
