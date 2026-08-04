# LinTVPlus Android Mobile

This module packages an existing LinTVPlus deployment as a touch-first Android
WebView application. It loads the regular responsive site instead of the
Android TV `/tv` route.

## Build

Java 17, Android SDK 35, and Gradle 8.10.2 are required.

```bash
cd apps/android-mobile
gradle assembleDebug \
  -PBASE_URL="https://example.com" \
  -PAPP_NAME="LinTVPlus" \
  -PUPDATE_REPOSITORY="lin1122lin/MoonTVPlus" \
  -PVERSION_NAME="1.0.6" \
  -PVERSION_CODE="7"
```

The debug APK is written to `app/build/outputs/apk/debug/app-debug.apk`.

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
