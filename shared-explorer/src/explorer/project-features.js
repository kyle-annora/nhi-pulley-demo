/** Project policy narrows a prepared package. A host can narrow it again, never widen it. */
export function featurePolicy(project, model) {
  const features = project.features;
  const renderStyles = features.renderStyles.filter(style => (model.capabilities?.renderStyles || ['engineering', 'linework', 'flat']).includes(style));
  const operation = Boolean(features.operation && model.capabilities?.operation);
  const modes = ['explore', ...(features.explode ? ['explode'] : []), ...(operation ? ['operate'] : [])];
  const requires = tourRequirements(model.tour);
  const tour = Boolean(features.tour && model.tour && requires.renderStyles.every(style => renderStyles.includes(style)) && (!requires.explode || features.explode) && (!requires.operation || operation));
  return Object.freeze({ renderStyles: Object.freeze(renderStyles), modes: Object.freeze(modes), operation, tours: Object.freeze(tour ? [model.tour.id] : []), themes: features.themes, qualityProfiles: Object.freeze(features.quality ? ['balanced', 'performance', 'quality'] : []) });
}

export function tourRequirements(tour) {
  const styles = new Set(); let explode = false, operation = false;
  const inspect = value => {
    if (!value || typeof value !== 'object') return;
    if (value.renderStyle) styles.add(value.renderStyle);
    if (value.mode === 'explode' || Array.isArray(value.explosion) && value.explosion.some(item => item > 0) || typeof value.explosion === 'number' && value.explosion > 0) explode = true;
    if (value.operation || value.mode === 'operate' || Number.isFinite(value.operationProgress)) operation = true;
    for (const item of Object.values(value)) if (item && typeof item === 'object') inspect(item);
  };
  inspect(tour); return { renderStyles: [...styles], explode, operation };
}

export function intersectCapabilities(policy = {}, requested = {}) {
  const output = { ...policy };
  for (const [key, value] of Object.entries(requested)) {
    const ceiling = policy[key];
    if (ceiling === false || value === false) output[key] = false;
    else if (Array.isArray(ceiling)) output[key] = Array.isArray(value) ? ceiling.filter(item => value.includes(item)) : [...ceiling];
    else output[key] = value;
  }
  return output;
}
