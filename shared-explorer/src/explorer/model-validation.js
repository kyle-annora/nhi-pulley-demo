/** Reject ambiguous geometry identity before the scene is created. */
export function validatePackage(metadata, model) {
  if (!Array.isArray(metadata.parts) || !metadata.parts.length) throw new Error('A model package needs component records.');
  if (!Array.isArray(metadata.groups) || !metadata.groups.length) throw new Error('A model package needs assembly groups.');
  const ids = new Set([model.rootId]), names = new Set(), grouped = new Set();
  const uniqueId = id => { if (typeof id !== 'string' || !id || ids.has(id)) throw new Error(`Duplicate or missing component identity: ${id}`); ids.add(id); };
  for (const part of metadata.parts) {
    uniqueId(part.id);
    if (typeof part.meshName !== 'string' || !part.meshName.trim() || names.has(part.meshName)) throw new Error(`Duplicate or missing mesh identity: ${part.meshName}`);
    names.add(part.meshName);
    if (!Array.isArray(part.center) || part.center.length !== 3 || !part.center.every(Number.isFinite)) throw new Error(`Invalid component bounds: ${part.id}`);
    if (part.explode && (!Array.isArray(part.explode) || part.explode.length !== 3 || !part.explode.every(Number.isFinite))) throw new Error(`Invalid presentation offset: ${part.id}`);
  }
  for (const group of metadata.groups) {
    uniqueId(group.id);
    for (const name of group.meshNames) {
      if (!names.has(name) || grouped.has(name)) throw new Error(`Ambiguous group membership: ${name}`);
      grouped.add(name);
    }
    const subgrouped = new Set();
    for (const child of group.children || []) if (child.id !== group.id) {
      uniqueId(child.id);
      for (const name of child.meshNames || []) {
        if (!group.meshNames.includes(name) || subgrouped.has(name)) throw new Error(`Ambiguous subgroup membership: ${name}`);
        subgrouped.add(name);
      }
    }
  }
  if (grouped.size !== names.size) throw new Error('The assembly groups do not cover the model.');
  for (const part of metadata.parts) {
    const group = metadata.groups.find(group => group.id === part.group);
    if (!group?.meshNames.includes(part.meshName)) throw new Error(`Component group mismatch: ${part.id}`);
  }
  const root = metadata.root || model.presentationPolicy?.root;
  if (!root?.id || root.id !== model.rootId) throw new Error('Root identity differs from the content package.');
  if (metadata.operation) {
    if (!metadata.operation.clipName || !Number.isFinite(metadata.operation.duration) || !(metadata.operation.duration > 0)) throw new Error('Operating content needs a named animation and positive duration.');
    let previous = -1;
    for (const stage of metadata.operation.stages || []) {
      if (!(stage.at >= 0 && stage.at < 1) || stage.at <= previous || !stage.title || (stage.nodeId && !ids.has(stage.nodeId))) throw new Error('Invalid operating stage.');
      previous = stage.at;
    }
  }
  return true;
}
