# Android release build handoff (v0.5.0)

Harmony has no JDK, Android SDK or signing key, so the APK/AAB is built on
another machine from a pushed commit. The web UI is bundled into the APK, so
every web fix (menu scroll, status-bar inset, calendar, copy trim) only reaches
phones through this build.

## Inputs

- Repo: `git@github.com:fluffnark/list-app.git`, branch `feat/calendar`
  (or the commit named in the request).
- Node 24, Java 21, Android SDK 36 (AGP 8.13 / Gradle 8.14.5 verified before).
- Release signing properties file (`storeFile`, `storePassword`, `keyAlias`,
  `keyPassword`), originally at `~/.local/share/listflow-signing/` on the
  workstation that built v0.4.1. Never commit it.

## Steps

```sh
git fetch origin && git checkout feat/calendar && git pull --ff-only
npm ci
npm run android:sync            # vite build with base "/" + cap sync android
cd android
LISTFLOW_SIGNING_FILE=/path/to/signing.properties \
  ./gradlew :app:assembleRelease :app:bundleRelease
```

Do **not** set `LISTFLOW_ALLOW_TEST_HTTP` for a release.

## Verify before handing back

1. Same signing key as v0.4.1, or phones can't update in place:
   `apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk`
   must show SHA-256 certificate digest
   `345039a3e44d7ba4d6493f4e381c26ccdd4dd0287b3115d597bf8116121ef357`
   (CN=ListFlow, O=Personal, C=US).
2. `versionCode 6`, `versionName 0.5.0` (`aapt dump badging` or apkanalyzer).
3. Optional on a device/emulator: install over v0.4.1, open the menu and
   scroll to Settings; the top bar must sit below the status bar.

## Hand back

Copy to `releases/listflow-v0.5.0.apk` and `releases/listflow-v0.5.0.aab`,
update `releases/README.md` to 0.5.0, commit, and push to the same branch.
Harmony then deploys; the web Settings download link already points at
`listflow-v0.5.0.apk`, so the web deploy waits for these files.
