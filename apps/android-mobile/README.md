# MoonTVPlus Android Mobile

This module packages an existing MoonTVPlus deployment as a touch-first Android
WebView application. It loads the regular responsive site instead of the
Android TV `/tv` route.

## Build

Java 17, Android SDK 35, and Gradle 8.10.2 are required.

```bash
cd apps/android-mobile
gradle assembleDebug \
  -PBASE_URL="https://example.com" \
  -PAPP_NAME="MoonTVPlus" \
  -PVERSION_NAME="1.0.2" \
  -PVERSION_CODE="3"
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
