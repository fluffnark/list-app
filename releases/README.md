# ListFlow 0.4.1

- `listflow-v0.4.1.apk`: signed installable Android app.
- `listflow-v0.4.1.aab`: signed app bundle for a future Play upload; not published to Play.
- `SHA256SUMS`: artifact checksums, generated during deployment.

Web and APK download are available on private HTTPS (and the explicitly enabled LAN HTTP origin):

https://harmony.great-kettle.ts.net:4443/listflow/

https://harmony.great-kettle.ts.net:4443/listflow/downloads/listflow-v0.4.1.apk

Connect the phone to Harmony's tailnet. In the web app, generate a personal Android device token; configure it and the HTTPS sync server URL in the Android app's Settings. The app remains usable offline.

See ../docs/VALIDATION.md for actual tests and limitations. Google OAuth/Sheets needs owner configuration; physical-device endurance and Play publishing are not claimed complete.

- `listflow-v0.5.1.apk` / `.aab`: source `21a2538`, versionCode 7, signed with the existing personal release certificate. Includes day/week/month calendar views and guided Google setup. Installed over 0.4.1 on the Pixel 7a without a data wipe; personal workspace sync and Google calendar display verified. See `listflow-v0.5.1-build.json` for hashes.
