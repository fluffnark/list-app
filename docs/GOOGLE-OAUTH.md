# Google setup

The application works locally and can sync using its owner password without Google. Google is needed only for Google sign-in, the optional Sheets projection, and Google Calendar. Calendar links (ICS) work without it.

1. Choose an existing Google Cloud project or create a free project. Enable the Google Sheets API and the Google Calendar API.
   For Google Home task capture, also enable the Google Tasks API. Add `https://www.googleapis.com/auth/tasks.readonly` to the consent screen's data access; ListFlow requests it only through **Allow Google Tasks access** in Settings.
2. Configure Google Auth Platform branding and audience. For testing, add the owner's exact Google account to Test users.
3. Add `openid`, `email`, `https://www.googleapis.com/auth/drive.file`, `https://www.googleapis.com/auth/calendar.calendarlist.readonly`, and `https://www.googleapis.com/auth/calendar.events` to Data Access.
4. Create a **Web application** OAuth client. Add the authorized redirect URI exactly:
   `https://harmony.great-kettle.ts.net:4443/listflow/auth/google/callback`
5. In ListFlow, sign in and open Settings → Calendars → Google setup. Enter the owner's Google email, the client ID and the client secret, then save. They are stored encrypted on Harmony (AES-256-GCM under `data/secret`), never in the repo or the browser. Changing the client or owner email discards any existing Google token.
   Optional fallback: if nothing is saved in Settings, the server reads `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `OWNER_EMAIL` from `/etc/listflow.env` (mode 0600; `sudo systemctl restart listflow` after editing).
6. Select **Sign in with Google**. Sign-in always starts and finishes on the canonical HTTPS origin (`https://harmony.great-kettle.ts.net:4443/listflow/`); opening it from the LAN HTTP address redirects there first. The browser must reach that address: be on the tailnet, or forward port 4443 over SSH to Harmony's tailnet IP and map the hostname to 127.0.0.1 in that browser.
7. Grant only the listed scopes. Then pick calendars under Settings → Calendars, optionally create / sync the spreadsheet, and use **Allow Google Tasks access** only if you want Google Tasks capture.

The server checks OAuth state, binds it to an HTTP-only browser cookie, exchanges the code server-side, verifies the userinfo response's `email_verified` field, and rejects accounts that do not match the configured owner email. Refresh credentials are encrypted with AES-256-GCM under `data/secret`; tokens never enter the spreadsheet.

Google may impose testing-mode refresh-token expiry or require consent verification depending on account/project policy. Reconnect from Settings when needed. This configuration must be exercised with the actual owner account before claiming live OAuth/Sheets validation.

Sources: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Google Sheets limits](https://developers.google.com/workspace/sheets/api/limits).

## Calendar

Settings → Calendars shows events from the Google calendars you tick and from any number of ICS links (Outlook: Settings → Calendar → Shared calendars → Publish a calendar). "Put dated tasks on" mirrors open tasks with a plan or due date as all-day events in one Google calendar; completing or deleting a task removes its event. ICS links are stored encrypted under `data/secret`, like the Google refresh token.
