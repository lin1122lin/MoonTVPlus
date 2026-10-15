const DEFAULTS = Object.freeze({
  shortcut: 'Ctrl+Alt+H',
  opacity: 1,
  hideTaskbar: false,
  autoHide: false,
});

function validatePreferences(value) {
  if (!value || typeof value !== 'object' ||
      typeof value.shortcut !== 'string' ||
      !/^(?:(?:Ctrl|Alt|Shift|Super)\+){1,3}(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/.test(value.shortcut) ||
      !/(?:Ctrl|Alt|Super)\+/.test(value.shortcut) ||
      typeof value.opacity !== 'number' || !Number.isFinite(value.opacity) ||
      value.opacity < 0.2 || value.opacity > 1 ||
      typeof value.hideTaskbar !== 'boolean' ||
      typeof value.autoHide !== 'boolean') {
    throw new Error('请使用有效快捷键，透明度范围为 20% 到 100%。');
  }
  return {
    shortcut: value.shortcut,
    opacity: value.opacity,
    hideTaskbar: value.hideTaskbar,
    autoHide: value.autoHide,
  };
}

function isInside(point, bounds) {
  return point.x >= bounds.x && point.x < bounds.x + bounds.width &&
    point.y >= bounds.y && point.y < bounds.y + bounds.height;
}

module.exports = { DEFAULTS, validatePreferences, isInside };
