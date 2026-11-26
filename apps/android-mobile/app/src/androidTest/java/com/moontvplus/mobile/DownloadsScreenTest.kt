package com.moontvplus.mobile

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.media3.exoplayer.offline.Download
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class DownloadsScreenTest {
    @get:Rule val compose = createComposeRule()

    @Test fun threeEntrancesAndEmptyStates() {
        var webOpened = false
        showScreen(onWeb = { webOpened = true })
        compose.onNodeWithText("安卓下载").assertIsDisplayed()
        compose.onNodeWithText("暂无安卓下载任务").assertIsDisplayed()
        compose.onNodeWithText("网页缓存").performClick()
        compose.runOnIdle { assertEquals(true, webOpened) }
        compose.onNodeWithText("本机文件").performClick()
        compose.onNodeWithText("暂无本机文件记录").assertIsDisplayed()
    }

    @Test fun nativeDeletionRequiresConfirmation() {
        val actions = mutableListOf<String>()
        showScreen(tasks = listOf(DownloadRow("sample", "测试视频", Download.STATE_COMPLETED, 100, 100, 100f)),
            onAction = { _, action -> actions.add(action) })
        compose.onNodeWithContentDescription("更多操作").performClick()
        compose.onNodeWithText("删除下载").performClick()
        compose.onNodeWithText("删除安卓下载？").assertIsDisplayed()
        compose.runOnIdle { assertEquals(emptyList<String>(), actions) }
        compose.onNodeWithText("取消").performClick()
        compose.runOnIdle { assertEquals(emptyList<String>(), actions) }
        compose.onNodeWithContentDescription("更多操作").performClick()
        compose.onNodeWithText("删除下载").performClick()
        compose.onNodeWithText("删除", useUnmergedTree = true).performClick()
        compose.runOnIdle { assertEquals(listOf("delete"), actions) }
    }

    @Test fun localRemovalOnlyCallsForget() {
        val row = LocalRow("content://example/video/1", "本机视频", false)
        val forgotten = mutableListOf<LocalRow>()
        val downloadActions = mutableListOf<String>()
        showScreen(localFiles = listOf(row), initialTab = 2,
            onForget = { forgotten.add(it) }, onAction = { _, action -> downloadActions.add(action) })
        compose.onNodeWithText("本机视频").assertIsDisplayed()
        compose.onNodeWithContentDescription("本机文件更多操作").performClick()
        compose.onNodeWithText("移除记录（保留源文件）").assertIsDisplayed()
        compose.runOnIdle { assertEquals(emptyList<LocalRow>(), forgotten) }
        compose.onNodeWithText("移除记录（保留源文件）").performClick()
        compose.runOnIdle {
            assertEquals(listOf(row), forgotten)
            assertEquals(emptyList<String>(), downloadActions)
        }
    }

    private fun showScreen(
        tasks: List<DownloadRow> = emptyList(), localFiles: List<LocalRow> = emptyList(),
        initialTab: Int = 0, onWeb: () -> Unit = {}, onForget: (LocalRow) -> Unit = {},
        onAction: (DownloadRow, String) -> Unit = { _, _ -> },
    ) {
        compose.setContent {
            DownloadsTheme {
                DownloadsScreen(tasks, localFiles, false, false, false, false,
                    onBack = {}, onWeb = onWeb, onRefresh = {}, onLocalRefresh = {},
                    onAction = onAction, onDocument = {}, onFolder = {}, onLocalPlay = {},
                    onForget = onForget, initialTab = initialTab)
            }
        }
    }
}
