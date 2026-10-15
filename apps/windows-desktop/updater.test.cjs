const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const vm = require('node:vm');

function createHarness(visible, portable = false) {
  const updater = new EventEmitter();
  const app = new EventEmitter();
  app.isPackaged = true;
  const calls = [];
  updater.checkForUpdates = async () => { updater.emit('update-available', { version: '1.0.1' }); };
  updater.downloadUpdate = async () => { calls.push('download'); };
  updater.quitAndInstall = () => calls.push('install');
  const electron = {
    app, shell: { openExternal: () => calls.push('browser') },
    dialog: { showMessageBox: async () => { calls.push('prompt'); return { response: 0 }; } },
  };
  const context = {
    module: { exports: {} }, console, process: { env: portable ? { PORTABLE_EXECUTABLE_DIR: 'C:/portable' } : {} },
    require: name => name === 'electron' ? electron : { autoUpdater: updater },
    setTimeout: () => 1, setInterval: () => 2, clearTimeout() {}, clearInterval() {},
  };
  vm.runInNewContext(fs.readFileSync(__dirname + '/updater.cjs', 'utf8'), context);
  const check = context.module.exports.setupUpdater({
    isVisible: () => visible, isMinimized: () => false, setProgressBar() {},
  });
  return { updater, check, calls, context };
}

test('hidden window does not show update prompts or start downloading', async () => {
  const { check, calls } = createHarness(false);
  await check();
  assert.deepEqual(calls, []);
});

test('installed version downloads only after confirmation and installs after another confirmation', async () => {
  const { check, updater, calls } = createHarness(true);
  await check();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['prompt', 'download']);
  updater.emit('update-downloaded');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['prompt', 'download', 'prompt', 'install']);
});

test('portable version offers the download page instead of installing', async () => {
  const { check, calls } = createHarness(true, true);
  await check();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['prompt', 'browser']);
});
