const { _electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lintvplus-smoke-'));
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (request.url === '/') {
      response.end('<script>location.replace("/login")</script>');
      return;
    }
    response.end('<html><title>LinTVPlus test</title><body><h1>LinTVPlus</h1><video></video></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let client;
  const closeClient = async () => {
    if (!client) return;
    await client.evaluate(({ app }) => { setImmediate(() => app.quit()); }).catch(() => {});
    const closing = client.close();
    const timeout = setTimeout(() => client.process().kill(), 8000);
    try { await closing; } finally { clearTimeout(timeout); client = undefined; }
  };
  const launch = () => _electron.launch({
    args: [__dirname],
    env: { ...process.env, LINTVPLUS_TEST_PROFILE: profile, LINTVPLUS_URL: 'http://127.0.0.1:' + server.address().port },
    timeout: 60000,
  });
  try {
    console.log('Launching Electron');
    client = await launch();
    const page = await client.firstWindow();
    await page.waitForURL(url => url.protocol === 'http:' && url.pathname === '/login', { timeout: 30000 });
    await page.waitForLoadState('domcontentloaded');
    console.log('Main window loaded');
    assert.equal(await page.evaluate(() => typeof window.desktopSettings), 'undefined');
    await client.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const original = win.setSkipTaskbar.bind(win);
      win.setSkipTaskbar = value => { win.testSkipTaskbar = value; original(value); };
    });
    const openSettings = async () => {
      const opened = client.waitForEvent('window');
      await client.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.find(item => item.label === '设置').click());
      const settings = await opened;
      await settings.waitForURL(url => url.pathname.endsWith('/settings.html'), { timeout: 30000 });
      await settings.waitForLoadState('domcontentloaded');
      return settings;
    };
    const settings = await openSettings();
    console.log('Settings window loaded');
    await settings.locator('#shortcut').focus();
    await settings.keyboard.press('Control+Shift+F9');
    await settings.locator('#opacity').evaluate(input => { input.value = '55'; input.dispatchEvent(new Event('input')); });
    await settings.locator('#hide-taskbar').check();
    await settings.locator('#auto-hide').check();
    await settings.locator('button[type=submit]').click();
    await settings.getByText('已保存', { exact: true }).waitFor();
    console.log('Settings saved');
    const state = await client.evaluate(({ BrowserWindow, globalShortcut }) => {
      const main = BrowserWindow.getAllWindows().find(win => !win.getParentWindow());
      const security = main.webContents.getLastWebPreferences();
      return { opacity: main.getOpacity(), skip: main.testSkipTaskbar, registered: globalShortcut.isRegistered('Ctrl+Shift+F9'), old: globalShortcut.isRegistered('Ctrl+Alt+H'), node: security.nodeIntegration, sandbox: security.sandbox };
    });
    assert(Math.abs(state.opacity - .55) < .01);
    assert.equal(state.skip, true);
    assert.equal(state.registered, true);
    assert.equal(state.old, false);
    assert.equal(state.node, false);
    assert.equal(state.sandbox, true);
    const saved = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'));
    assert.equal(saved.autoHide, true);
    await settings.screenshot({ path: path.join(profile, 'settings.png') });
    await (await client.browserWindow(settings)).evaluate(win => win.close());
    await client.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.find(item => item.label === '立即隐藏').click());
    assert.deepEqual(await client.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return { visible: win.isVisible(), muted: win.webContents.isAudioMuted(), skip: win.testSkipTaskbar };
    }), { visible: false, muted: true, skip: true });
    await client.evaluate(({ app }) => app.emit('second-instance'));
    assert.equal(await client.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
    await client.evaluate(({ BrowserWindow, screen }) => {
      const bounds = BrowserWindow.getAllWindows()[0].getBounds();
      screen.getCursorScreenPoint = () => ({ x: bounds.x + 20, y: bounds.y + 20 });
    });
    await new Promise(resolve => setTimeout(resolve, 350));
    await client.evaluate(({ screen }) => { screen.getCursorScreenPoint = () => ({ x: -100000, y: -100000 }); });
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(await client.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
    console.log('Hide/restore and mouse-leave checks passed; restarting');
    await closeClient();
    client = await launch();
    await (await client.firstWindow()).waitForURL(url => url.pathname === '/login', { timeout: 30000 });
    assert.equal(await client.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Ctrl+Shift+F9')), true);
    console.log('PASS: native hide/restore, taskbar flag, 55% opacity, shortcut registration, mouse-leave hide, saved settings and sandbox.');
    console.log('Settings screenshot: ' + path.join(profile, 'settings.png'));
  } finally {
    await closeClient();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
