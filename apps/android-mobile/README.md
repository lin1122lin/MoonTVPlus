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
  -PVERSION_NAME="1.0.0" \
  -PVERSION_CODE="1"
```

The debug APK is written to `app/build/outputs/apk/debug/app-debug.apk`.

For a signed release build, set `ANDROID_KEYSTORE_PATH`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and
`ANDROID_KEY_PASSWORD`, then run `gradle assembleRelease`.
