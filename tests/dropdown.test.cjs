const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function loadTemplate() {
  const content = {
    state: { currentSource: 'steam' },
    constants: {
      SOURCES: { steam: { id: 'steam', label: 'Steam' } },
      STEAM_GAME_FILTERS: [
        { value: '100', label: '100%' }, { value: 'owned', label: 'Possédé' }, { value: 'played', label: 'Joué' }
      ]
    },
    renderIcon: () => '',
    getSourceMeta: () => ({ label: 'Steam' }),
    renderSourceLogo: () => '',
    escapeHtml: (value) => value,
    getExtensionIconUrl: () => ''
  };
  const sandbox = vm.createContext({ TMContent: content });
  vm.runInContext(fs.readFileSync(path.join(root, 'content', 'modal', 'content-modal-template.js'), 'utf8'), sandbox);
  return sandbox.TMContent.renderModalTemplate();
}

test('source and Steam filters expose matching accessible custom listboxes', () => {
  const html = loadTemplate();
  for (const id of ['tm-source', 'tm-steam-filter']) {
    assert.match(html, new RegExp(`id="${id}-toggle"[^>]*aria-haspopup="listbox"[^>]*aria-controls="${id}-menu"`));
    assert.match(html, new RegExp(`id="${id}-menu"[^>]*role="listbox"[^>]*hidden`));
  }
  assert.doesNotMatch(html, /tm-steam-filter-select|tm-native-select/);
});

test('dropdown styling hides closed menus and marks selection without relying on color', () => {
  const css = fs.readFileSync(path.join(root, 'content', 'styles', 'content-source-picker.css'), 'utf8');
  assert.match(css, /\.tm-source-menu\[hidden\]\s*\{\s*display:\s*none !important/);
  assert.match(css, /\[aria-selected="true"\] \.tm-dropdown-check\s*\{\s*visibility:\s*visible/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
});
