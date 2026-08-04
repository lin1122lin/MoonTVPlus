plugins {
    id("com.android.application")
}

fun propOrEnv(propName: String, envName: String, defaultValue: String): String {
    return (project.findProperty(propName) as String?)
        ?: System.getenv(envName)
        ?: defaultValue
}

val rawBaseUrl = propOrEnv("BASE_URL", "BASE_URL", "https://tv.987951.xyz")
val appDisplayName = propOrEnv("APP_NAME", "APP_NAME", "LinTVPlus")
val applicationIdValue = propOrEnv(
    "APPLICATION_ID",
    "APPLICATION_ID",
    "com.moontvplus.mobile"
)
val updateRepository = propOrEnv(
    "UPDATE_REPOSITORY",
    "UPDATE_REPOSITORY",
    "lin1122lin/MoonTVPlus"
)
val updateManifestUrl = propOrEnv(
    "UPDATE_MANIFEST_URL",
    "UPDATE_MANIFEST_URL",
    "https://github.com/$updateRepository/releases/latest/download/android-mobile-update.json"
)
val versionNameValue = propOrEnv("VERSION_NAME", "VERSION_NAME", "1.0.5")
val versionCodeValue = propOrEnv("VERSION_CODE", "VERSION_CODE", "6").toIntOrNull() ?: 6
val minSdkValue = propOrEnv("MIN_SDK", "MIN_SDK", "23").toIntOrNull() ?: 23

fun escapeJavaString(value: String): String = value
    .replace("\\", "\\\\")
    .replace("\"", "\\\"")

fun escapeXmlString(value: String): String = value
    .replace("&", "&amp;")
    .replace("<", "&lt;")
    .replace(">", "&gt;")
    .replace("'", "\\'")
    .replace("\"", "\\\"")

android {
    namespace = "com.moontvplus.mobile"
    compileSdk = 35

    defaultConfig {
        applicationId = applicationIdValue
        minSdk = minSdkValue
        targetSdk = 35
        versionCode = versionCodeValue
        versionName = versionNameValue

        buildConfigField("String", "BASE_URL", "\"${escapeJavaString(rawBaseUrl)}\"")
        buildConfigField(
            "String",
            "UPDATE_MANIFEST_URL",
            "\"${escapeJavaString(updateManifestUrl)}\""
        )
        buildConfigField(
            "String",
            "UPDATE_REPOSITORY",
            "\"${escapeJavaString(updateRepository)}\""
        )
        resValue("string", "app_name", escapeXmlString(appDisplayName))
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    signingConfigs {
        create("release") {
            val storeFilePath = System.getenv("ANDROID_KEYSTORE_PATH")
            if (!storeFilePath.isNullOrBlank() && file(storeFilePath).exists()) {
                storeFile = file(storeFilePath)
                storeType = propOrEnv(
                    "ANDROID_KEYSTORE_TYPE",
                    "ANDROID_KEYSTORE_TYPE",
                    "PKCS12"
                )
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            isDebuggable = true
        }
        release {
            isMinifyEnabled = false
            val storeFilePath = System.getenv("ANDROID_KEYSTORE_PATH")
            if (!storeFilePath.isNullOrBlank() && file(storeFilePath).exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
}
