/** Approved fluorescent accents shared by DOM and WebGL. Ember remains the default. */
export const CLIENT_THEMES = Object.freeze([
  { id: 'ember', name: 'Ember', description: 'Orange-red', accent: '#ff6840' },
  { id: 'laser-red', name: 'Laser red', description: 'Fluorescent red', accent: '#ff3b5c' },
  { id: 'amber', name: 'Amber', description: 'Electric amber', accent: '#ffb52e' },
  { id: 'volt-yellow', name: 'Volt yellow', description: 'Fluorescent yellow', accent: '#edff33' },
  { id: 'acid-lime', name: 'Acid lime', description: 'Acid yellow-green', accent: '#b6ff2e' },
  { id: 'signal-green', name: 'Signal green', description: 'Electric green', accent: '#00f5a0' },
  { id: 'arc-cyan', name: 'Arc cyan', description: 'Electric cyan', accent: '#00e5ff' },
  { id: 'ion-blue', name: 'Ion blue', description: 'Electric blue', accent: '#4385ff' },
  { id: 'plasma-violet', name: 'Plasma violet', description: 'Electric violet', accent: '#b66bff' },
  { id: 'magenta', name: 'Magenta', description: 'Fluorescent magenta', accent: '#ff3ed1' }
].map(palette => Object.freeze(palette)));

const PANEL = '#181a1c';
const RAISED_SURFACE = '#292d31';
export const normalizeHex = value => typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value) ? value.toLowerCase() : null;
const channels = value => [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16));
const hex = rgb => '#' + rgb.map(value => Math.round(value).toString(16).padStart(2, '0')).join('');
const linearChannel = value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
const linearRGB = rgb => rgb.map(value => linearChannel(value / 255));
const luminance = rgb => linearRGB(rgb).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
const composite = (foreground, background, alpha) => foreground.map((value, index) => value * alpha + background[index] * (1 - alpha));

export function resolveTheme(id, customAccent) {
  const custom = normalizeHex(customAccent);
  if (id === 'custom' && custom) return Object.freeze({ id: 'custom', name: 'Custom', description: 'Client accent', accent: custom });
  const legacy = { blue: '#65b4ff', champagne: '#ddcba7' };
  if (Object.hasOwn(legacy, id)) return Object.freeze({ id: 'custom', name: 'Custom', description: 'Client accent', accent: legacy[id] });
  return CLIENT_THEMES.find(palette => palette.id === id) || CLIENT_THEMES[0];
}

export function themeRoles(palette) {
  const accent = normalizeHex(palette?.accent) || CLIENT_THEMES[0].accent;
  const rgb = channels(accent), bases = [channels(PANEL), channels(RAISED_SURFACE)];
  const washAlpha = .10, strongAlpha = .16;
  // Text must remain readable on both inactive and selected surfaces. The original
  // accent remains unchanged for swatches and fluorescent contours; text is adjusted.
  // Raised surfaces are included because the full Explorer uses them in overlays.
  let readable = [...rgb];
  for (let step = 0; step < 255; step++) {
    if (bases.flatMap(base => [base, composite(rgb, base, washAlpha), composite(rgb, base, strongAlpha)]).every(surface => contrast(readable, surface) >= 4.5)) break;
    readable = readable.map(value => Math.min(255, value + 1));
  }
  const content = hex(readable), joined = rgb.join(', ');
  const roles = {
    accent, content, rgb: joined,
    wash: `rgba(${joined}, ${washAlpha})`,
    strong: `rgba(${joined}, ${strongAlpha})`,
    border: `rgba(${readable.join(', ')}, 0.48)`,
    // sRGB hex is suitable for THREE.Color.set(). outlineLinear is the standard
    // sRGB-to-linear conversion for raw shader uniforms. Do not apply both.
    // An outline composed before tone mapping remains affected by that pass;
    // exact display accents belong in an untonemapped overlay after it.
    outline: luminance(rgb) < .05 ? content : accent,
    outlineLinear: linearRGB(luminance(rgb) < .05 ? readable : rgb),
    onAccent: '#171519'
  };
  roles.cssTokens = {
    '--accent': roles.content,
    '--accent-raw': roles.accent,
    '--accent-rgb': roles.rgb,
    '--accent-light': roles.content,
    '--accent-wash': roles.wash,
    '--accent-border': roles.border,
    '--accent-strong': roles.strong
  };
  return roles;
}


/** Existing token and persistence API retained for the floating Explorer shell. */
export function applyThemeTokens(theme, root = document.documentElement) {
  const roles = themeRoles(theme);
  for (const [token, value] of Object.entries(roles.cssTokens)) root.style.setProperty(token, value);
  root.dataset.theme = theme.id;
  return roles;
}
