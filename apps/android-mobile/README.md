# LinTVPlus Android Mobile

This module packages an existing LinTVPlus deployment as a touch-first Android
WebView application. It loads the regular responsive site instead of the
Android TV `/tv` route.

## Build

Node.js 22, Java 17, Android SDK 35, and Gradle 8.10.2 are required.

```bash
cd apps/android-mobile
cd offline-web
npm ci --ignore-scripts
npm test
npm run build
cd ..
gradle assembleDebug \
  -PBASE_URL="https://example.com" \
  -PAPP_NAME="LinTVPlus" \
  -PUPDATE_REPOSITORY="lin1122lin/MoonTVPlus" \
  -PVERSION_NAME="1.0.8" \
  -PVERSION_CODE="9"
```

The debug APK is written to `app/build/outputs/apk/debug/app-debug.apk`.

## Local Downloads

Android background downloads are explicitly selected in the site's settings.
The native download screen separates Android downloads, legacy web cache and
user-selected local files. Changing engines does not migrate or remove tasks.

The bundled web-cache page is served from the original site's origin by the
existing WebView, so it can read that app's `MoonTVPlusVideoCache` and
`MoonTVPlus` databases without a network connection. It never migrates or
deletes old records and only plays local blob resources. Cache stored in an
external browser is separate from the app's WebView storage.

Incomplete IndexedDB tasks can play a read-only snapshot of the contiguous
cached prefix of their selected download range. Playback stops at the first
missing segment; it never skips holes or marks the episode complete. Retrying
failed segments or finalization preserves previously saved video data.

Exported videos are opened with Android's system document picker. Fragment
downloads require selection of the single-episode folder containing
`playlist.m3u8`, `segment_N.ts` and, if encrypted, `key.key`. Network references
in local playlists are blocked. Only read access is retained; removing a recent
file entry never deletes the original file. Missing/revoked grants require
selecting the file again. Cloud document providers still need their own network
access; select files actually stored on the phone for offline viewing.

For a signed release build, set `ANDROID_KEYSTORE_PATH`,
`ANDROID_KEYSTORE_TYPE`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
and `ANDROID_KEY_PASSWORD`, then run `gradle assembleRelease`.

The GitHub Actions workflow reads the permanent mobile signing key from these
repository secrets:

- `ANDROID_MOBILE_KEYSTORE_BASE64`
- `ANDROID_MOBILE_KEYSTORE_PASSWORD`
- `ANDROID_MOBILE_KEY_ALIAS`
- `ANDROID_MOBILE_KEY_PASSWORD`

Keep the original keystore and passwords outside GitHub. Every update must use
the same application ID and signing key, and `VERSION_CODE` must increase.

GitHub Secrets cannot be read back after they are saved, so they are not a
keystore backup. Keep at least two private copies of the original `.p12` file
and store its alias and passwords in a password manager. Never commit signing
files or credentials to this repository.

## In-app updates

The app checks the following release asset at most once every 15 minutes:

```text
https://github.com/lin1122lin/MoonTVPlus/releases/latest/download/android-mobile-update.json
```

When a newer `versionCode` is available, the app shows an update dialog,
downloads the APK with Android `DownloadManager`, and verifies its SHA-256,
package name, version code, and signing certificate before opening the system
package installer. Android 8 and newer require the user to allow LinTVPlus as
an install source once. The final installation confirmation is always handled
by Android.

To publish an update, manually run the `Build Android Mobile APK` workflow and:

1. Increase both `version_name` and `version_code`.
2. Enable `publish_release`.
3. Enter the release notes shown to users.
4. Leave `mandatory_update` disabled unless the old version must be blocked.

The workflow requires all four signing secrets. It creates an
`android-mobile-v<version>` GitHub Release containing the signed APK,
`SHA256SUMS.txt`, and `android-mobile-update.json`, and marks that release as
the latest Android update.
