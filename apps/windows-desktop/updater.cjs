const { autoUpdater } = require('electron-updater');
const { app, dialog, shell } = require('electron');

function setupUpdater(window) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  let checking = false;
  let manual = false;
  let downloaded = false;
  let offeredVersion = '';
  const portable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
  const visible = () => window.isVisible() && !window.isMinimized();

  autoUpdater.on('error', error => {
    checking = false;
    window.setProgressBar(-1);
    if (manual && visible()) dialog.showMessageBox(window, {
      type: 'error', title: '更新检查失败', message: '无法连接更新服务，请稍后重试。',
    });
    console.error('Desktop update failed:', error.message);
    manual = false;
  });
  autoUpdater.on('update-not-available', () => {
    checking = false;
    if (manual && visible()) dialog.showMessageBox(window, {
      type: 'info', title: 'LinTVPlus 更新', message: '当前已是最新版本。',
    });
    manual = false;
  });
  autoUpdater.on('update-available', async info => {
    checking = false;
    if (!visible() || (!manual && offeredVersion === info.version)) return;
    offeredVersion = info.version;
    manual = false;
    const answer = await dialog.showMessageBox(window, {
      type: 'info', title: 'LinTVPlus 更新',
      message: '发现新版本 ' + info.version,
      detail: portable ? '免安装版请下载新版 EXE 后替换。' : '下载完成后可重启安装。',
      buttons: [portable ? '打开下载页' : '下载更新', '稍后'], defaultId: 0, cancelId: 1,
    });
    if (answer.response !== 0) return;
    if (portable) {
      shell.openExternal('https://github.com/lin1122lin/MoonTVPlus/releases/tag/windows-v' + encodeURIComponent(info.version));
    } else autoUpdater.downloadUpdate().catch(() => {});
  });
  autoUpdater.on('download-progress', progress => {
    window.setProgressBar(visible() ? progress.percent / 100 : -1);
  });
  autoUpdater.on('update-downloaded', async () => {
    downloaded = true;
    window.setProgressBar(-1);
    if (visible()) await install();
  });
  async function install() {
    const answer = await dialog.showMessageBox(window, {
      type: 'info', title: 'LinTVPlus 更新', message: '更新已下载，立即重启安装？',
      buttons: ['重启安装', '稍后'], defaultId: 0, cancelId: 1,
    });
    if (answer.response === 0) autoUpdater.quitAndInstall();
  }
  async function check(isManual = false) {
    if (!app.isPackaged) {
      if (isManual) dialog.showMessageBox(window, { message: '开发模式不检查更新。' });
      return;
    }
    if (checking) return;
    if (downloaded && visible()) { await install(); return; }
    checking = true;
    manual = isManual;
    try { await autoUpdater.checkForUpdates(); }
    catch { checking = false; }
  }
  const startupTimer = setTimeout(() => { if (visible()) check(); }, 15000);
  const timer = setInterval(() => { if (visible()) check(); }, 15 * 60 * 1000);
  app.on('before-quit', () => { clearTimeout(startupTimer); clearInterval(timer); });
  return () => check(true);
}

module.exports = { setupUpdater };
