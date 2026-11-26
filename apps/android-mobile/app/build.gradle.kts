plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.04.01"))
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.documentfile:documentfile:1.0.1")
    implementation("androidx.media3:media3-exoplayer:1.8.0")
    implementation("androidx.media3:media3-exoplayer-hls:1.8.0")
    implementation("androidx.media3:media3-ui:1.8.0")
    implementation("androidx.media3:media3-datasource-okhttp:1.8.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation(platform("androidx.compose:compose-bom:2025.04.01"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
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
val versionNameValue = propOrEnv("VERSION_NAME", "VERSION_NAME", "1.0.8")
val versionCodeValue = propOrEnv("VERSION_CODE", "VERSION_CODE", "9").toIntOrNull() ?: 9
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
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        buildConfigField("String", "BASE_URL", "\"${escapeJavaString(rawBaseUrl)}\"")
        buildConfigField("boolean", "ENABLE_USB_DEBUGGING", (project.findProperty("ENABLE_USB_DEBUGGING") == "true").toString())
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
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

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

tasks.named("preBuild") {
    doFirst {
        check(file("src/main/assets/offline/index.html").isFile) {
            "Build offline assets first: cd offline-web && npm ci --ignore-scripts && npm run build"
        }
    }
}
