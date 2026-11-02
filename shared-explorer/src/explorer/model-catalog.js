import { MODEL_CATALOG as GENERATED_CATALOG } from '../generated/catalog.js';
import { PROJECT_CONFIG } from '../generated/project.js';
import { featurePolicy } from './project-features.js';

export { validatePackage } from './model-validation.js';
export const MODEL_CATALOG = Object.freeze(Object.fromEntries(Object.entries(GENERATED_CATALOG).map(([id, model]) => [id, Object.freeze({ ...model, allowedCapabilities: featurePolicy(PROJECT_CONFIG, model) })])));
export function resolveModel(id) { return Object.hasOwn(MODEL_CATALOG, id) ? MODEL_CATALOG[id] : MODEL_CATALOG[PROJECT_CONFIG.defaultModel]; }
