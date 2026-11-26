package com.moontvplus.mobile

import android.content.Context
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import android.widget.FrameLayout

class ConnectionPanel(context: Context, downloads: Runnable, legacy: Runnable, retry: Runnable) : FrameLayout(context) {
    private var statusText by mutableStateOf("正在连接 LinTVPlus…")

    init {
        addView(ComposeView(context).apply {
            setContent {
                DownloadsTheme {
                    Surface(Modifier.fillMaxSize()) {
                        Column(
                            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center
                        ) {
                            Image(painterResource(R.drawable.logo), null, Modifier.size(88.dp))
                            Spacer(Modifier.height(16.dp))
                            Text("LinTVPlus", style = MaterialTheme.typography.headlineSmall)
                            Spacer(Modifier.height(12.dp))
                            Text(statusText, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Spacer(Modifier.height(28.dp))
                            Button(onClick = { downloads.run() }, Modifier.widthIn(max = 360.dp).fillMaxWidth().heightIn(min = 48.dp)) {
                                Text("我的下载")
                            }
                            OutlinedButton(onClick = { legacy.run() }, Modifier.widthIn(max = 360.dp).fillMaxWidth().heightIn(min = 48.dp)) {
                                Text("网页缓存")
                            }
                            TextButton(onClick = { retry.run() }, Modifier.heightIn(min = 48.dp)) {
                                Icon(Icons.Default.Refresh, null)
                                Spacer(Modifier.width(8.dp))
                                Text("重试连接")
                            }
                        }
                    }
                }
            }
        }, LayoutParams(-1, -1))
    }

    fun setMessage(value: String) { statusText = value }
}
