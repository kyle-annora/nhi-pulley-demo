import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { CLIENT_THEMES, normalizeHex, resolveTheme, themeRoles, applyThemeTokens } from '../../src/explorer/themes.js';
import { viewingRegion } from '../../src/explorer/viewing-region.js';

function luminance(value) {
  const rgb = value.match(/[a-f\d]{2}/gi).map(channel => parseInt(channel, 16) / 255);
  const linear = rgb.map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + .05) / (values[1] + .05);
}
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-8, `${label}: ${actual} ≠ ${expected}`);

test('theme accent validation accepts six-digit hex and rejects non-string or CSS-shaped inputs', () => {
  assert.equal(normalizeHex('#AbC123'), '#abc123');
  for (const value of [undefined, null, 0, {}, [], ['#ff0000'], { toString: () => '#ff0000' }, '#abc', '#12345678', 'red', ' #123456 ', '#12345g', 'var(--color)', '#ffffff; color:red']) {
    assert.equal(normalizeHex(value), null, `Invalid accent accepted: ${String(value)}`);
  }
});

test('unknown presets and malformed custom themes resolve safely to the default', () => {
  assert.equal(resolveTheme('does-not-exist').id, CLIENT_THEMES[0].id);
  assert.equal(resolveTheme('custom', '#invalid').id, CLIENT_THEMES[0].id);
  assert.equal(resolveTheme('custom', ['#abcdef']).id, CLIENT_THEMES[0].id);
  assert.deepEqual(resolveTheme('custom', '#AbCDef'), {
    id: 'custom', name: 'Custom', description: 'Client accent', accent: '#abcdef'
  });
  assert.deepEqual(resolveTheme('blue'), { id: 'custom', name: 'Custom', description: 'Client accent', accent: '#65b4ff' });
  assert.equal(resolveTheme('champagne').accent, '#ddcba7');
});

test('every client preset has a unique stable ID and valid rendered roles', () => {
  assert.equal(new Set(CLIENT_THEMES.map(theme => theme.id)).size, CLIENT_THEMES.length);
  for (const theme of CLIENT_THEMES) {
    const roles = themeRoles(resolveTheme(theme.id));
    assert.equal(roles.accent, normalizeHex(theme.accent));
    assert.ok(normalizeHex(roles.content));
    assert.ok(normalizeHex(roles.outline));
    assert.ok(contrast(roles.content, '#1f1f22') >= 4.5, `${theme.id} labels need contrast`);
  }
});

test('very dark client colors retain their brand fill while producing readable labels and focus accents', () => {
  for (const accent of ['#000000', '#010203', '#220011', '#7d0024', '#00007f']) {
    const roles = themeRoles(resolveTheme('custom', accent));
    assert.equal(roles.accent, accent, 'Brand fill must not be silently replaced');
    assert.ok(contrast(roles.content, '#1f1f22') >= 4.5, accent);
    assert.notEqual(roles.content, accent, 'Dark accents need a readable content variant');
    assert.ok(normalizeHex(roles.outline), 'Renderer receives a valid explicit outline color');
    assert.notEqual(roles.outline, '#000000');
  }
});

test('CSS tokens and renderer roles come from the same theme snapshot', () => {
  const values = new Map();
  const root = { style: { setProperty: (name, value) => values.set(name, value) }, dataset: {} };
  for (const theme of [...CLIENT_THEMES, resolveTheme('custom', '#190818')]) {
    const roles = applyThemeTokens(theme, root);
    assert.deepEqual(roles, themeRoles(theme));
    assert.equal(root.dataset.theme, theme.id);
    assert.equal(values.get('--accent-raw'), roles.accent);
    assert.equal(values.get('--accent'), roles.content);
    assert.equal(values.get('--accent-light'), roles.content);
    assert.equal(values.get('--accent-rgb'), roles.rgb);
    assert.equal(values.get('--accent-wash'), roles.wash);
    assert.equal(values.get('--accent-border'), roles.border);
    assert.equal(values.get('--accent-strong'), roles.strong);
    assert.equal(values.size, 7, 'Theme switches should overwrite the same semantic roles');
  }
});

test('theme derivation does not mutate a saved client configuration', () => {
  const theme = Object.freeze({ id: 'custom', name: 'Customer', accent: '#210011' });
  const first = themeRoles(theme), second = themeRoles(theme);
  assert.deepEqual(first, second);
  assert.deepEqual(theme, { id: 'custom', name: 'Customer', accent: '#210011' });
});

test('an unobstructed viewport uses the whole canvas and ignores negative insets', () => {
  const full = { width: 1440, height: 900, offsetX: 0, offsetY: 0 };
  assert.deepEqual(viewingRegion(1440, 900), full);
  assert.deepEqual(viewingRegion(1440, 900, { left: -12, right: -4, top: -8, bottom: -40 }), full);
});

test('asymmetric side panels recenter into the visible rectangle without resizing the canvas', () => {
  const width = 1440, height = 900;
  for (const insets of [
    { left: 280, right: 320, top: 100, bottom: 90 },
    { left: 280, right: 24, top: 100, bottom: 90 },
    { left: 24, right: 320, top: 100, bottom: 90 }
  ]) {
    const region = viewingRegion(width, height, insets);
    assert.equal(region.width, width - insets.left - insets.right);
    assert.equal(region.height, height - insets.top - insets.bottom);
    near(width / 2 - region.offsetX - region.width / 2, insets.left, 'Left boundary');
    near(height / 2 - region.offsetY - region.height / 2, insets.top, 'Top boundary');
  }
});

test('a mobile bottom sheet reduces vertical fit and raises the model without narrowing it', () => {
  const collapsed = viewingRegion(390, 844, { left: 16, right: 16, top: 130, bottom: 120 });
  const expanded = viewingRegion(390, 844, { left: 16, right: 16, top: 130, bottom: 360 });
  assert.equal(expanded.width, collapsed.width);
  assert.equal(expanded.height, collapsed.height - 240);
  assert.equal(expanded.offsetX, 0);
  assert.equal(expanded.offsetY - collapsed.offsetY, 120);
});

test('view-region offsets agree with Three.js projection for sidebars and mobile sheets', () => {
  for (const { width, height, insets } of [
    { width: 1440, height: 900, insets: { left: 280, right: 24, top: 100, bottom: 90 } },
    { width: 1440, height: 900, insets: { left: 24, right: 320, top: 100, bottom: 90 } },
    { width: 390, height: 844, insets: { left: 16, right: 16, top: 130, bottom: 360 } }
  ]) {
    const region = viewingRegion(width, height, insets);
    const camera = new PerspectiveCamera(15, width / height, .05, 150);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.setViewOffset(width, height, region.offsetX, region.offsetY, width, height);
    camera.updateMatrixWorld();
    const projected = new Vector3(0, 0, 0).project(camera);
    const x = (projected.x + 1) * width / 2;
    const y = (1 - projected.y) * height / 2;
    near(x, insets.left + region.width / 2, 'Projected horizontal center');
    near(y, insets.top + region.height / 2, 'Projected vertical center');
  }
});
