/** Shared illustrative finishes. Package-specific curation is injected as data. */
export const FINISHES = Object.freeze({
  structure: Object.freeze({ family: 'structure', label: 'Structural satin', color: '#b3b5b7', metalness: .88, roughness: .52 }),
  satin: Object.freeze({ family: 'satin', label: 'Satin silver', color: '#c2c5c9', metalness: .94, roughness: .40 }),
  machined: Object.freeze({ family: 'machined', label: 'Dark machined', color: '#737981', metalness: .96, roughness: .36 }),
  polished: Object.freeze({ family: 'polished', label: 'Bright hardware', color: '#e1e4e8', metalness: 1, roughness: .21 }),
  polymer: Object.freeze({ family: 'polymer', label: 'Polymer and seals', color: '#303236', metalness: 0, roughness: .86 }),
  glass: Object.freeze({ family: 'glass', label: 'Smoked glazing', color: '#1c3037', metalness: 0, roughness: .08 }),
  bronze: Object.freeze({ family: 'bronze', label: 'Warm bearing finish', color: '#bd9455', metalness: .96, roughness: .30 }),
  indicator: Object.freeze({ family: 'indicator', label: 'Coated surround', color: '#963d2d', metalness: 0, roughness: .44 })
});

const SOURCE_FINISH = Object.freeze({
  'Brushed steel': 'satin', 'Polished steel': 'polished',
  'Satin aluminum': 'structure', 'Polymer and seals': 'polymer',
  'Window glass': 'glass', 'Bronze bearing': 'bronze', 'Release indicator': 'indicator'
});

/** Pass the metadata record together with sourceMaterial: originalMaterial.name. */
export function materialSpec(record = {}, policy = {}) {
  record = record && typeof record === 'object' ? record : {};
  const sourceMaterial = typeof record.sourceMaterial === 'string' ? record.sourceMaterial : 'Unspecified';
  let family = Object.hasOwn(SOURCE_FINISH, sourceMaterial) ? SOURCE_FINISH[sourceMaterial] : 'satin';
  let basis = Object.hasOwn(SOURCE_FINISH, sourceMaterial) ? 'Prepared asset material label' : 'Neutral fallback';
  const rules = policy.finishes;
  if (rules?.eligibleSources?.includes(sourceMaterial)) {
    if (record.group === rules.sourceRoles?.group) {
      const role = typeof record.sourceName === 'string' ? record.sourceName.replace(/\.\d+$/, '') : '';
      if (Object.hasOwn(rules.sourceRoles.families, role)) {
        family = rules.sourceRoles.families[role]; basis = rules.sourceRoles.basis;
      }
    } else if (Object.hasOwn(rules.groups || {}, record.group)) {
      ({ family, basis } = rules.groups[record.group]);
    }
  }
  return { ...FINISHES[family], sourceMaterial, illustrative: true, basis };
}

export function technicalSpec() {
  return { color: '#15171b', metalness: 0, roughness: 1, lineColor: '#b9bec5', lineOpacity: .82 };
}
