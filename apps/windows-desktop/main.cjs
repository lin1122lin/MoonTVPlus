const { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, screen, shell, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { DEFAULTS, validatePreferences, isInside } = require('./preferences.cjs');
const { setupUpdater } = require('./updater.cjs');

app.setName('LinTVPlus');
if (!app.isPackaged && process.env.LINTVPLUS_TEST_PROFILE) app.setPath('userData', process.env.LINTVPLUS_TEST_PROFILE);
const siteUrl = (!app.isPackaged && process.env.LINTVPLUS_URL) || 'https://tv.987951.xyz';
const siteOrigin = new URL(siteUrl).origin;
let window, settingsWindow, tray, preferences, settingsPath, cursorTimer;
let wasInside = false;
let quitting = false;
const settingsUrl = pathToFileURL(path.join(__dirname, 'settings.html')).href;

function restore() {
  wasInside = false;
  if (window.isMinimized()) window.restore();
  window.setSkipTaskbar(preferences.hideTaskbar);
  window.webContents.setAudioMuted(false);
  window.show();
  window.focus();
}

function hide() {
  settingsWindow?.hide();
  window.webContents.setAudioMuted(true);
  if (new URL(window.webContents.getURL() || siteUrl).origin === siteOrigin) {
    window.webContents.executeJavaScript("document.querySelectorAll('video,audio').forEach(media => media.pause())").catch(() => {});
  }
  window.setSkipTaskbar(true);
  window.setProgressBar(-1);
  window.hide();
  wasInside = false;
}

function toggle() {
  if (window.isVisible() && !window.isMinimized()) hide();
  else restore();
}

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    title: 'LinTVPlus 设置', width: 440, height: 510,
    resizable: false, minimizable: false, maximizable: false,
    parent: window, autoHideMenuBar: true, backgroundColor: '#fafafa',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  settingsWindow.setMenu(null);
  settingsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  settingsWindow.webContents.on('will-navigate', event => event.preventDefault());
  settingsWindow.on('closed', () => { settingsWindow = undefined; wasInside = false; });
  settingsWindow.loadURL(settingsUrl);
}

function applyPreferences(next) {
  const changed = !preferences || preferences.shortcut !== next.shortcut;
  if (changed && !globalShortcut.register(next.shortcut, toggle)) {
    throw new Error('快捷键已被占用，请换一个组合。');
  }
  try {
    const temporaryPath = settingsPath + '.tmp';
    fs.writeFileSync(temporaryPath, JSON.stringify(next, null, 2));
    fs.renameSync(temporaryPath, settingsPath);
  } catch (error) {
    if (changed) globalShortcut.unregister(next.shortcut);
    throw new Error('设置保存失败，请检查用户目录是否可写。');
  }
  if (changed && preferences) globalShortcut.unregister(preferences.shortcut);
  preferences = next;
  window.setOpacity(next.opacity);
  window.setSkipTaskbar(!window.isVisible() || next.hideTaskbar);
  wasInside = false;
  tray.setToolTip('LinTVPlus · ' + next.shortcut);
}

function assertSettingsSender(event) {
  if (event.sender !== settingsWindow?.webContents || event.senderFrame?.url !== settingsUrl) {
    throw new Error('Invalid settings sender');
  }
}

function openExternal(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) restore(); });
  app.whenReady().then(() => {
    app.setAppUserModelId('lin.tvplus.desktop');
    settingsPath = path.join(app.getPath('userData'), 'settings.json');
    let saved = { ...DEFAULTS };
    try { saved = validatePreferences(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))); }
    catch (error) {
      if (error.code !== 'ENOENT') dialog.showErrorBox('LinTVPlus 设置', '设置文件无法读取，本次使用默认值。');
    }
    const icon = app.isPackaged ? path.join(process.resourcesPath, 'logo.png') : path.join(__dirname, '../../public/logo.png');
    window = new BrowserWindow({
      title: 'LinTVPlus', width: 1100, height: 760, minWidth: 360, minHeight: 320,
      show: false, backgroundColor: '#000000', icon,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'persist:lintvplus' },
    });
    tray = new Tray(icon);
    const checkForUpdates = setupUpdater(window);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示 / 隐藏', click: toggle },
      { label: '设置', click: openSettings },
      { label: '检查更新', click: checkForUpdates },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ]));
    tray.on('click', restore);
    tray.on('double-click', restore);
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'LinTVPlus', submenu: [
        { label: '设置', click: openSettings },
        { label: '立即隐藏', click: hide },
        { label: '检查更新', click: checkForUpdates },
        { type: 'separator' }, { role: 'quit', label: '退出' },
      ] },
      { label: '查看', submenu: [{ role: 'reload', label: '刷新' }, { role: 'togglefullscreen', label: '全屏' }] },
    ]));
    ipcMain.handle('settings:read', event => { assertSettingsSender(event); return preferences; });
    ipcMain.handle('settings:save', (event, value) => {
      assertSettingsSender(event);
      try { applyPreferences(validatePreferences(value)); return { ok: true }; }
      catch (error) { return { ok: false, error: error.message }; }
    });
    try { applyPreferences(saved); }
    catch (error) {
      preferences = saved;
      window.setOpacity(saved.opacity);
      tray.setToolTip('LinTVPlus');
      dialog.showErrorBox('LinTVPlus 设置', error.message + ' 可从托盘打开设置。');
    }
    window.on('close', event => { if (!quitting) { event.preventDefault(); hide(); } });
    window.once('ready-to-show', restore);
    window.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
    window.webContents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== siteOrigin) { event.preventDefault(); openExternal(url); }
    });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((contents, permission, callback) => {
      callback(new URL(contents.getURL() || siteUrl).origin === siteOrigin &&
        ['fullscreen', 'clipboard-sanitized-write'].includes(permission));
    });
    window.loadURL(siteUrl).catch(error => dialog.showErrorBox('LinTVPlus', '站点加载失败，请通过“查看 → 刷新”重试。'));
    cursorTimer = setInterval(() => {
      if (!preferences.autoHide || !window.isVisible() || window.isMinimized() || settingsWindow?.isVisible()) { wasInside = false; return; }
      const inside = isInside(screen.getCursorScreenPoint(), window.getBounds());
      if (wasInside && !inside) hide();
      wasInside = inside;
    }, 150);
  }).catch(error => { dialog.showErrorBox('LinTVPlus', error.message); app.quit(); });
}

app.on('before-quit', () => { quitting = true; clearInterval(cursorTimer); globalShortcut.unregisterAll(); });
app.on('window-all-closed', () => { if (quitting) app.quit(); });
