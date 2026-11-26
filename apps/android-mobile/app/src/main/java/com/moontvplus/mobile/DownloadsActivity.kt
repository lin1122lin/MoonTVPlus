package com.moontvplus.mobile

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Build
import android.provider.DocumentsContract
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.core.view.WindowCompat
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadRequest
import androidx.media3.exoplayer.offline.DownloadService
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale

internal data class DownloadRow(
    val id: String,
    val title: String,
    val state: Int,
    val bytes: Long,
    val total: Long,
    val percent: Float,
    val paused: Boolean = false,
    val request: DownloadRequest? = null,
)

internal data class LocalRow(val uri: String, val title: String, val folder: Boolean)

class DownloadsActivity : ComponentActivity() {
    private var tasks by mutableStateOf<List<DownloadRow>>(emptyList())
    private var localFiles by mutableStateOf<List<LocalRow>>(emptyList())
    private var loading by mutableStateOf(true)
    private var readError by mutableStateOf(false)
    private var localLoading by mutableStateOf(true)
    private var localError by mutableStateOf(false)

    private val openDocument = registerForActivityResult(ActivityResultContracts.OpenDocument()) {
        it?.let { uri -> importLocal(uri, false) }
    }
    private val openTree = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) {
        it?.let { uri -> importLocal(uri, true) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            DownloadsTheme {
                val dark = isSystemInDarkTheme()
                val surface = MaterialTheme.colorScheme.surface.toArgb()
                SideEffect {
                    window.statusBarColor = surface
                    window.navigationBarColor = if (Build.VERSION.SDK_INT >= 26) surface else android.graphics.Color.BLACK
                    WindowCompat.getInsetsController(window, window.decorView).apply {
                        isAppearanceLightStatusBars = !dark
                        isAppearanceLightNavigationBars = Build.VERSION.SDK_INT >= 26 && !dark
                    }
                }
                DownloadsScreen(
                    tasks, localFiles, loading, readError, localLoading, localError,
                    onBack = { finish() },
                    onWeb = {
                        startActivity(Intent(this, MainActivity::class.java).putExtra("showLegacyDownloads", true))
                        finish()
                    },
                    onRefresh = { lifecycleScope.launch { refreshDownloads() } },
                    onLocalRefresh = { lifecycleScope.launch { refreshLocal() } },
                    onAction = ::downloadAction,
                    onDocument = { safely { openDocument.launch(arrayOf("video/*", "application/vnd.apple.mpegurl")) } },
                    onFolder = { safely { openTree.launch(null) } },
                    onLocalPlay = ::playLocal,
                    onForget = { row ->
                        lifecycleScope.launch {
                            try {
                                withContext(Dispatchers.IO) { LocalVideoFiles.forget(this@DownloadsActivity, row.uri) }
                                refreshLocal()
                            } catch (error: CancellationException) { throw error }
                            catch (_: Exception) { message("移除记录失败，请重试") }
                        }
                    },
                    initialTab = if (intent.getBooleanExtra("showLocalFiles", false)) 2 else 0,
                )
            }
        }
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                refreshLocal()
                while (true) {
                    refreshDownloads()
                    delay(1_000)
                }
            }
        }
    }

    private suspend fun refreshDownloads() {
        try {
            // DownloadManager belongs to the main looper; only index reads run on IO.
            val manager = OfflineDownloads.manager(this)
            val paused = manager.downloadsPaused
            val index = manager.downloadIndex
            tasks = withContext(Dispatchers.IO) {
                buildList {
                    index.getDownloads().use { cursor ->
                        while (cursor.moveToNext()) {
                            val task = cursor.download
                            add(DownloadRow(task.request.id, OfflineDownloads.title(task.request),
                                task.state, task.bytesDownloaded, task.contentLength,
                                task.percentDownloaded, paused, task.request))
                        }
                    }
                }
            }
            readError = false
        } catch (error: CancellationException) { throw error }
        catch (_: Exception) { readError = true }
        finally { loading = false }
    }

    private suspend fun refreshLocal() {
        try {
            localFiles = withContext(Dispatchers.IO) {
                val files = LocalVideoFiles.all(this@DownloadsActivity)
                buildList {
                    for (i in 0 until files.length()) {
                        val row = files.optJSONObject(i) ?: continue
                        val uri = row.optString("uri")
                        if (uri.isNotBlank()) add(LocalRow(uri, row.optString("title", "本机视频"), row.optBoolean("folder")))
                    }
                }
            }
            localError = false
        } catch (error: CancellationException) { throw error }
        catch (_: Exception) { localError = true }
        finally { localLoading = false }
    }

    private fun importLocal(uri: Uri, folder: Boolean) {
        lifecycleScope.launch {
            try {
                val persisted = withContext(Dispatchers.IO) {
                    val title = validateLocal(uri, folder)
                    val granted = try {
                        contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        true
                    } catch (_: SecurityException) {
                        false
                    }
                    LocalVideoFiles.remember(this@DownloadsActivity, uri, title, folder)
                    granted
                }
                if (!persisted) message("无法保存长期读取授权，本次仍可播放；下次可能需要重新选择")
                refreshLocal()
                startLocal(uri.toString(), folder)
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) { message(error.message ?: "无法打开本机文件，请重新选择") }
        }
    }

    private fun validateLocal(uri: Uri, folder: Boolean): String {
        require(uri.scheme == "content" && !uri.authority.isNullOrBlank()) { "请选择有效的本机文件" }
        if (folder) {
            require(DocumentsContract.isTreeUri(uri)) { "请选择单集下载文件夹" }
            LocalFolderSource.playlist(this, uri)
        }
        val title = LocalVideoFiles.title(this, uri)
        if (!folder) {
            val type = contentResolver.getType(uri)?.lowercase(Locale.ROOT)
            require(!title.lowercase(Locale.ROOT).endsWith(".m3u8") &&
                type != "application/vnd.apple.mpegurl" && type != "application/x-mpegurl" &&
                type != "audio/mpegurl" && type != "audio/x-mpegurl") {
                "单个 m3u8 无法读取相邻分片，请选择包含 playlist.m3u8 的单集文件夹"
            }
            require(type.isNullOrBlank() || type.startsWith("video/") || type == "application/octet-stream") {
                "请选择视频文件"
            }
            contentResolver.openFileDescriptor(uri, "r").use { requireNotNull(it) { "无法读取本机文件" } }
        }
        return title
    }

    private fun playLocal(row: LocalRow) {
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) { validateLocal(Uri.parse(row.uri), row.folder) }
                startLocal(row.uri, row.folder)
            } catch (error: CancellationException) { throw error }
            catch (_: Exception) {
                message("授权已失效或文件不可用，请重新选择${if (row.folder) "单集文件夹" else "视频文件"}")
                safely {
                    if (row.folder) openTree.launch(null)
                    else openDocument.launch(arrayOf("video/*", "application/vnd.apple.mpegurl"))
                }
            }
        }
    }

    private fun startLocal(uri: String, folder: Boolean) = safely {
        startActivity(Intent(this, OfflinePlayerActivity::class.java)
            .putExtra(if (folder) "localTree" else "localUri", uri))
    }

    private fun downloadAction(row: DownloadRow, action: String) = safely {
        when (action) {
            "play" -> startActivity(Intent(this, OfflinePlayerActivity::class.java).putExtra("downloadId", row.id))
            "pause" -> DownloadService.sendSetStopReason(this, OfflineDownloadService::class.java, row.id, 1, false)
            "resume" -> {
                val request = requireNotNull(row.request)
                OfflineDownloads.manager(this).resumeDownloads()
                DownloadService.sendAddDownload(this, OfflineDownloadService::class.java, request, true)
                DownloadService.sendSetStopReason(this, OfflineDownloadService::class.java, row.id, 0, true)
            }
            "delete" -> DownloadService.sendRemoveDownload(this, OfflineDownloadService::class.java, row.id, true)
        }
        lifecycleScope.launch { refreshDownloads() }
    }

    private fun safely(action: () -> Unit) {
        try { action() } catch (_: Exception) { message("操作失败，请稍后重试") }
    }

    private fun message(text: String) { Toast.makeText(this, text, Toast.LENGTH_LONG).show() }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun DownloadsScreen(
    tasks: List<DownloadRow>, localFiles: List<LocalRow>, loading: Boolean, readError: Boolean,
    localLoading: Boolean, localError: Boolean,
    onBack: () -> Unit, onWeb: () -> Unit, onRefresh: () -> Unit, onLocalRefresh: () -> Unit,
    onAction: (DownloadRow, String) -> Unit, onDocument: () -> Unit, onFolder: () -> Unit,
    onLocalPlay: (LocalRow) -> Unit, onForget: (LocalRow) -> Unit,
    initialTab: Int = 0,
) {
    var tab by rememberSaveable { mutableIntStateOf(if (initialTab == 2) 2 else 0) }
    var deleting by remember { mutableStateOf<DownloadRow?>(null) }
    Scaffold(topBar = {
        TopAppBar(title = { Text("我的下载") }, navigationIcon = {
            DownloadIconButton(Icons.AutoMirrored.Filled.ArrowBack, "返回", onBack)
        }, actions = {
            DownloadIconButton(Icons.Default.Refresh, "刷新列表", if (tab == 0) onRefresh else onLocalRefresh)
        })
    }) { insets ->
        Column(Modifier.fillMaxSize().padding(insets).consumeWindowInsets(insets)) {
            PrimaryTabRow(selectedTabIndex = tab) {
                listOf("安卓下载", "网页缓存", "本机文件").forEachIndexed { index, title ->
                    Tab(selected = tab == index, onClick = { if (index == 1) onWeb() else tab = index },
                        modifier = Modifier.heightIn(min = 48.dp), text = { Text(title) })
                }
            }
            if (tab == 0) {
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    item { Text("安卓下载 · ${tasks.size} 项", style = MaterialTheme.typography.titleSmall) }
                    if (loading) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
                    if (readError) item { Text("读取下载列表失败，请刷新重试", color = MaterialTheme.colorScheme.error) }
                    if (!loading && !readError && tasks.isEmpty()) item { EmptyDownloads("暂无安卓下载任务") }
                    items(tasks, key = { it.id }) { row ->
                        DownloadItem(row, onAction = { onAction(row, it) }, onDelete = { deleting = row })
                        HorizontalDivider(Modifier.padding(top = 16.dp))
                    }
                }
            } else {
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            FilledTonalButton(onClick = onDocument, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                                Icon(Icons.Default.Add, null)
                                Spacer(Modifier.width(8.dp))
                                Text("打开视频文件")
                            }
                            OutlinedButton(onClick = onFolder, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                                Icon(Icons.Default.Add, null)
                                Spacer(Modifier.width(8.dp))
                                Text("打开单集文件夹")
                            }
                        }
                    }
                    item { Text("最近打开 · ${localFiles.size} 项", style = MaterialTheme.typography.titleSmall) }
                    if (localLoading) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
                    if (localError) item { Text("读取本机记录失败，请刷新重试", color = MaterialTheme.colorScheme.error) }
                    if (!localLoading && !localError && localFiles.isEmpty()) item { EmptyDownloads("暂无本机文件记录") }
                    items(localFiles, key = { it.uri }) { row ->
                        var localMenu by remember { mutableStateOf(false) }
                        Column {
                            Text(row.title, style = MaterialTheme.typography.titleMedium)
                            Text(if (row.folder) "本机单集文件夹" else "本机视频文件", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                                DownloadIconButton(Icons.Default.PlayArrow, "播放 ${row.title}", { onLocalPlay(row) })
                                Box {
                                    DownloadIconButton(Icons.Default.MoreVert, "本机文件更多操作", { localMenu = true })
                                    DropdownMenu(expanded = localMenu, onDismissRequest = { localMenu = false }) {
                                        DropdownMenuItem(
                                            text = { Text("移除记录（保留源文件）") },
                                            leadingIcon = { Icon(Icons.Default.Delete, null) },
                                            onClick = { localMenu = false; onForget(row) },
                                            modifier = Modifier.heightIn(min = 48.dp),
                                        )
                                    }
                                }
                            }
                            HorizontalDivider()
                        }
                    }
                }
            }
        }
    }
    deleting?.let { row ->
        AlertDialog(onDismissRequest = { deleting = null }, title = { Text("删除安卓下载？") },
            text = { Text("将删除“${row.title}”的下载记录和已下载文件。") },
            confirmButton = {
                TextButton(onClick = { deleting = null; onAction(row, "delete") }, modifier = Modifier.heightIn(min = 48.dp)) { Text("删除") }
            }, dismissButton = {
                TextButton(onClick = { deleting = null }, modifier = Modifier.heightIn(min = 48.dp)) { Text("取消") }
            })
    }
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
private fun DownloadIconButton(icon: ImageVector, label: String, onClick: () -> Unit, enabled: Boolean = true) {
    TooltipBox(
        positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(),
        tooltip = { PlainTooltip { Text(label) } },
        state = rememberTooltipState(),
    ) {
        IconButton(onClick = onClick, enabled = enabled, modifier = Modifier.size(48.dp)) {
            Icon(icon, contentDescription = label)
        }
    }
}

@Composable
private fun EmptyDownloads(title: String) {
    Box(Modifier.fillMaxWidth().padding(vertical = 40.dp), contentAlignment = Alignment.Center) {
        Text(title, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun DownloadItem(row: DownloadRow, onAction: (String) -> Unit, onDelete: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    val removing = row.state == Download.STATE_REMOVING || row.state == Download.STATE_RESTARTING
    val active = !row.paused && (row.state == Download.STATE_DOWNLOADING || row.state == Download.STATE_QUEUED)
    val state = when {
        row.state == Download.STATE_COMPLETED -> "已完成"
        row.state == Download.STATE_FAILED -> "下载失败"
        removing -> "正在移除"
        row.state == Download.STATE_STOPPED || row.paused -> "已暂停"
        row.state == Download.STATE_DOWNLOADING -> "下载中"
        else -> "等待网络或排队中"
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(row.title, style = MaterialTheme.typography.titleMedium, maxLines = 3, overflow = TextOverflow.Ellipsis)
        Text(state, color = if (row.state == Download.STATE_FAILED) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
        if (row.percent.isFinite() && row.percent >= 0) {
            LinearProgressIndicator(progress = { row.percent.coerceIn(0f, 100f) / 100f }, modifier = Modifier.fillMaxWidth())
        } else if (active || removing) {
            LinearProgressIndicator(Modifier.fillMaxWidth())
        }
        Text(buildString {
            append(formatBytes(row.bytes))
            if (row.total > 0) append(" / ${formatBytes(row.total)}")
            if (row.percent.isFinite() && row.percent >= 0) append(String.format(Locale.ROOT, " · %.0f%%", row.percent.coerceIn(0f, 100f)))
        }, style = MaterialTheme.typography.bodySmall)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
            if (row.state == Download.STATE_COMPLETED) {
                DownloadIconButton(Icons.Default.PlayArrow, "播放 ${row.title}", { onAction("play") })
            } else if (!removing) {
                TextButton(onClick = { onAction(if (active) "pause" else "resume") }, modifier = Modifier.heightIn(min = 48.dp)) {
                    if (!active) { Icon(Icons.Default.Refresh, null); Spacer(Modifier.width(8.dp)) }
                    Text(if (active) "暂停" else if (row.state == Download.STATE_FAILED) "重试" else "继续")
                }
            }
            Box {
                DownloadIconButton(Icons.Default.MoreVert, "更多操作", { menu = true }, enabled = !removing)
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text("删除下载") }, leadingIcon = { Icon(Icons.Default.Delete, null) },
                        onClick = { menu = false; onDelete() }, modifier = Modifier.heightIn(min = 48.dp))
                }
            }
        }
    }
}

private fun formatBytes(bytes: Long): String = if (bytes >= 1_073_741_824L) {
    String.format(Locale.ROOT, "%.2f GB", bytes / 1_073_741_824.0)
} else String.format(Locale.ROOT, "%.1f MB", bytes.coerceAtLeast(0) / 1_048_576.0)

@Preview(name = "Downloads Light", showBackground = true, widthDp = 360, heightDp = 760)
@Preview(name = "Downloads Dark", showBackground = true, widthDp = 360, heightDp = 760, uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun DownloadsPreview() {
    DownloadsTheme {
        DownloadsScreen(
            tasks = listOf(
                DownloadRow("1", "示例影片 · 第 1 集", Download.STATE_DOWNLOADING, 134_217_728, 536_870_912, 25f),
                DownloadRow("2", "示例影片 · 第 2 集", Download.STATE_COMPLETED, 536_870_912, 536_870_912, 100f),
                DownloadRow("3", "示例影片 · 第 3 集", Download.STATE_FAILED, 10_485_760, -1, -1f),
            ), localFiles = emptyList(), loading = false, readError = false, localLoading = false, localError = false,
            onBack = {}, onWeb = {}, onRefresh = {}, onLocalRefresh = {}, onAction = { _, _ -> },
            onDocument = {}, onFolder = {}, onLocalPlay = {}, onForget = {},
        )
    }
}
