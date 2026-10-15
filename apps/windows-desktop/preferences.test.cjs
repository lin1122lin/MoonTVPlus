const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, validatePreferences, isInside } = require('./preferences.cjs');

test('preferences retain only known valid values', () => {
  assert.deepEqual(validatePreferences({ ...DEFAULTS, injected: true }), DEFAULTS);
  assert.equal(validatePreferences({ ...DEFAULTS, shortcut: 'Ctrl+Shift+F8', opacity: .2 }).opacity, .2);
  for (const change of [{ shortcut: 'H' }, { shortcut: 'Shift+H' }, { shortcut: 'Ctrl+Alt+Delete' }, { opacity: NaN }, { opacity: 0 }, { opacity: 2 }, { autoHide: 'yes' }]) {
    assert.throws(() => validatePreferences({ ...DEFAULTS, ...change }));
  }
});

test('mouse boundaries handle multiple monitors and edges', () => {
  const bounds = { x: -800, y: 20, width: 800, height: 600 };
  assert.equal(isInside({ x: -800, y: 20 }, bounds), true);
  assert.equal(isInside({ x: -1, y: 619 }, bounds), true);
  assert.equal(isInside({ x: 0, y: 20 }, bounds), false);
  assert.equal(isInside({ x: -10, y: 620 }, bounds), false);
});
