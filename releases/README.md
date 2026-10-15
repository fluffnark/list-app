# ListFlow 0.1.0

- `listflow-v0.1.0.apk`: signed installable Android app.
- `listflow-v0.1.0.aab`: signed app bundle for a future Play upload; not published to Play.
- `SHA256SUMS`: artifact checksums, generated during deployment.

Web and APK download are Tailscale-only:

https://harmony.great-kettle.ts.net:4443/listflow/

https://harmony.great-kettle.ts.net:4443/listflow/downloads/listflow-v0.1.0.apk

Connect the phone to Harmony's tailnet. In the web app, generate a personal Android device token; configure it and the HTTPS sync server URL in the Android app's Settings. The app remains usable offline.

See ../docs/VALIDATION.md for actual tests and limitations. Google OAuth/Sheets needs owner configuration; physical-device endurance and Play publishing are not claimed complete.
