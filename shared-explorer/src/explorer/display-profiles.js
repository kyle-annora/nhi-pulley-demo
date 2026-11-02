/** Display preferences are independent of source geometry, motion and client accent. */
export const DISPLAY_DEFAULTS = Object.freeze({ grid: false, ambientOcclusion: true, featureEdges: true, hiddenEdges: false, lineWeight: 'standard' });
export const LINE_WEIGHTS = Object.freeze({ fine: .8, standard: 1, bold: 1.25 });
export const DISPLAY_PROFILES = Object.freeze({
  engineering: { title: 'Engineering', description: 'Read materials, surfaces and contact.', legend: 'Engineering finishes · Studio light', icon: 'cube' },
  linework: { title: 'Linework', description: 'Read outlines and internal features.', legend: 'Visible edges · No surface shading', icon: 'linework' },
  flat: { title: 'Flat accent', description: 'Explain one part in its assembly.', legend: 'Selected part filled · Neighbors in linework', icon: 'layers' },
});
export function displayOptions(patch = {}, previous = DISPLAY_DEFAULTS) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('Display options must be an object.');
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(DISPLAY_DEFAULTS, key)) throw new TypeError(`Unknown display option: ${key}`);
    if (key === 'lineWeight' ? !Object.hasOwn(LINE_WEIGHTS, value) : typeof value !== 'boolean') throw new TypeError(`Invalid display option: ${key}`);
  }
  return { ...DISPLAY_DEFAULTS, ...previous, ...patch };
}
