const shortcut = document.getElementById('shortcut');
const opacity = document.getElementById('opacity');
const status = document.getElementById('status');
const shortcutError = document.getElementById('shortcut-error');

shortcut.addEventListener('keydown', event => {
  if (event.key === 'Tab') return;
  event.preventDefault();
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
  const key = event.key.toUpperCase();
  if (!(event.ctrlKey || event.altKey || event.metaKey) || !/^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/.test(key)) {
    shortcutError.textContent = '请按 Ctrl、Alt 或 Win 与字母、数字或 F 键的组合。';
    return;
  }
  shortcut.value = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super', key].filter(Boolean).join('+');
  shortcutError.textContent = '';
  status.textContent = '';
});

opacity.addEventListener('input', () => {
  document.getElementById('opacity-value').value = opacity.value + '%';
  status.textContent = '';
});

window.desktopSettings.read().then(value => {
  shortcut.value = value.shortcut;
  opacity.value = String(Math.round(value.opacity * 100));
  document.getElementById('opacity-value').value = opacity.value + '%';
  document.getElementById('hide-taskbar').checked = value.hideTaskbar;
  document.getElementById('auto-hide').checked = value.autoHide;
}).catch(() => { status.textContent = '无法读取设置，请重新打开此窗口。'; });

document.getElementById('settings').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const result = await window.desktopSettings.save({
      shortcut: shortcut.value,
      opacity: Number(opacity.value) / 100,
      hideTaskbar: document.getElementById('hide-taskbar').checked,
      autoHide: document.getElementById('auto-hide').checked,
    });
    status.textContent = result.ok ? '已保存' : result.error;
  } catch { status.textContent = '保存失败，请重试。'; }
  finally { button.disabled = false; }
});
