# Google setup

The application works locally and can sync using its owner password without Google. Google is needed only for Google sign-in and the optional Sheets projection.

1. Choose an existing Google Cloud project or create a free project. Enable the Google Sheets API.
2. Configure Google Auth Platform branding and audience. For testing, add the owner's exact Google account to Test users.
3. Add `openid`, `email`, and `https://www.googleapis.com/auth/drive.file` to Data Access.
4. Create a **Web application** OAuth client. Add the authorized redirect URI exactly:
   `https://harmony.great-kettle.ts.net:4443/listflow/auth/google/callback`
5. Edit `/etc/listflow.env` on Harmony with `sudoedit`, adding `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `OWNER_EMAIL`. Keep this file mode 0600. Do not paste credentials into repo files or logs.
6. `sudo systemctl restart listflow`
7. In the web app, Settings → Connect Google. Grant only the listed scopes. Then Create / sync spreadsheet.

The server checks OAuth state, binds it to an HTTP-only browser cookie, exchanges the code server-side, verifies the userinfo response's `email_verified` field, and rejects accounts that do not match `OWNER_EMAIL`. Refresh credentials are encrypted with AES-256-GCM under `data/secret`; tokens never enter the spreadsheet.

Google may impose testing-mode refresh-token expiry or require consent verification depending on account/project policy. Reconnect from Settings when needed. This configuration must be exercised with the actual owner account before claiming live OAuth/Sheets validation.

Sources: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Google Sheets limits](https://developers.google.com/workspace/sheets/api/limits).
