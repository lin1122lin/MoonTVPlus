package com.moontvplus.mobile

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

@Composable
fun DownloadsTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val colors = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        if (dark) dynamicDarkColorScheme(LocalContext.current)
        else dynamicLightColorScheme(LocalContext.current)
    } else if (dark) {
        darkColorScheme(
            primary = Color(0xFF80D5C2), secondary = Color(0xFFBAC7DB),
            tertiary = Color(0xFFF1B6C8), background = Color(0xFF101413),
            surface = Color(0xFF101413), onPrimary = Color(0xFF00382E),
            primaryContainer = Color(0xFF005143), onPrimaryContainer = Color(0xFFA0F2DE),
            secondaryContainer = Color(0xFF3B485D), onSecondaryContainer = Color(0xFFD6E3FA),
        )
    } else {
        lightColorScheme(
            primary = Color(0xFF006B59), secondary = Color(0xFF526078),
            tertiary = Color(0xFF8A4B61), background = Color(0xFFF6FAF7),
            surface = Color(0xFFF6FAF7), onPrimary = Color.White,
            primaryContainer = Color(0xFFA0F2DE), onPrimaryContainer = Color(0xFF002019),
            secondaryContainer = Color(0xFFD6E3FA), onSecondaryContainer = Color(0xFF101C30),
        )
    }
    MaterialTheme(colorScheme = colors, content = content)
}
