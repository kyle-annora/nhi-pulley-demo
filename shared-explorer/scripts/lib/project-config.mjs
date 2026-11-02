import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { PropertyBinding } from 'three';
import { validatePackage } from '../../src/explorer/model-validation.js';
import { buildHierarchy } from '../../src/explorer/model-state.js';
import { sampleTour } from '../../src/explorer/tour-content.js';
import { featurePolicy } from '../../src/explorer/project-features.js';
import { FINISHES } from '../../src/explorer/appearance.js';

const STYLES = ['engineering', 'linework', 'flat'];
const ASSETS = ['model', 'compressedModel', 'metadata', 'edges', 'compressedEdges', 'edgeMetadata', 'silhouettes', 'compressedSilhouettes', 'silhouetteMetadata', 'license'];
const FIELD_NAMES = { model: 'modelUrl', compressedModel: 'compressedUrl', metadata: 'metadataUrl', edges: 'edgesUrl', compressedEdges: 'compressedEdgesUrl', edgeMetadata: 'edgeMetadataUrl', silhouettes: 'silhouettesUrl', compressedSilhouettes: 'compressedSilhouettesUrl', silhouetteMetadata: 'silhouetteMetadataUrl', license: 'licenseUrl' };
export { FIELD_NAMES };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const text = (value, label, max = 5000) => requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value), `${label} must be a nonempty string (maximum ${max} characters).`);
const keys = (value, allowed, label) => { requireValue(plain(value), `${label} must be an object.`); for (const key of Object.keys(value)) requireValue(allowed.includes(key), `${label}.${key} is not supported by schemaVersion 1.`); };
const id = (value, label) => requireValue(typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value) && !['constructor', 'prototype', '__proto__'].includes(value), `${label} must use a lowercase letter followed by letters, digits or hyphens.`);
const finiteVector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const fraction = value => Number.isFinite(value) && value >= 0 && value <= 1;
const canonical = value => JSON.stringify(value, (_, item) => plain(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

function validatePolicy(policy = {}, metadata, rootId) {
  keys(policy, ['root', 'subassemblyDescription', 'spatialGrouping', 'explosion', 'finishes', 'navigationIcons', 'actionDuration'], 'presentationPolicy');
  const groups = new Set(metadata.groups.map(group => group.id)), ids = new Set([rootId, ...groups, ...metadata.parts.map(part => part.id), ...metadata.groups.flatMap(group => (group.children || []).filter(child => child.id !== group.id).map(child => child.id))]);
  const vector = (value, label) => requireValue(finiteVector(value) && value.every(number => Math.abs(number) <= 1e6), `${label} needs three bounded finite numbers.`);
  const groupId = (value, label) => requireValue(groups.has(value), `${label} references an unknown assembly group: ${value}`);
  const family = value => requireValue(Object.hasOwn(FINISHES, value), `Unknown presentation finish family: ${value}`);
  if (policy.actionDuration !== undefined) requireValue(Number.isFinite(policy.actionDuration) && policy.actionDuration >= .5 && policy.actionDuration <= 10, 'actionDuration must be 0.5–10 presentation seconds.');
  if (policy.root) { keys(policy.root, ['id', 'title', 'description'], 'presentationPolicy.root'); requireValue(policy.root.id === rootId, 'presentationPolicy.root.id differs from the manifest.'); text(policy.root.title, 'presentation root title', 200); if (policy.root.description !== undefined) text(policy.root.description, 'presentation root description'); }
  text(metadata.root?.title || policy.root?.title, 'assembly root title', 200);
  for (const group of metadata.groups) { text(group.title, 'assembly group title', 200); for (const child of group.children || []) if (child.id !== group.id) text(child.title, 'subassembly title', 200); }
  if (policy.subassemblyDescription !== undefined) text(policy.subassemblyDescription, 'subassemblyDescription');
  if (policy.spatialGrouping) {
    const split = policy.spatialGrouping; keys(split, ['minimumParts', 'axis', 'splitAt', 'upper', 'lower', 'description'], 'spatialGrouping');
    requireValue(Number.isInteger(split.minimumParts) && split.minimumParts >= 0 && [0, 1, 2].includes(split.axis) && Number.isFinite(split.splitAt), 'spatialGrouping needs a nonnegative count, axis 0–2 and finite splitAt.'); text(split.description, 'spatial grouping description');
    for (const side of ['upper', 'lower']) { keys(split[side], ['id', 'title'], `spatialGrouping.${side}`); id(split[side].id, `spatialGrouping.${side}.id`); text(split[side].title, 'spatial group title', 200); }
    requireValue(split.upper.id !== split.lower.id, 'Spatial group IDs must differ.');
    for (const group of metadata.groups) if (!(group.children || []).some(child => child.id !== group.id) && group.meshNames.length > split.minimumParts) for (const side of ['upper', 'lower']) {
      const hasParts = metadata.parts.some(part => part.group === group.id && (side === 'upper' ? part.center[split.axis] >= split.splitAt : part.center[split.axis] < split.splitAt));
      if (hasParts) { const generatedId = `${group.id}-${split[side].id}`; requireValue(!ids.has(generatedId), `Spatial grouping collides with component identity: ${generatedId}`); ids.add(generatedId); }
    }
  }
  if (policy.explosion) {
    const explosion = policy.explosion; keys(explosion, ['rootVectors', 'radial', 'scopeFactors'], 'presentationPolicy.explosion');
    for (const [key, value] of Object.entries(explosion.rootVectors || {})) { groupId(key, 'explosion.rootVectors'); vector(value, 'root explosion vector'); }
    for (const [key, value] of Object.entries(explosion.scopeFactors || {})) { requireValue(ids.has(key), `explosion.scopeFactors references an unknown component: ${key}`); vector(value, 'scope explosion factors'); }
    if (explosion.radial) { const radial = explosion.radial; keys(radial, ['group', 'origin', 'factors'], 'explosion.radial'); groupId(radial.group, 'explosion.radial'); vector(radial.origin, 'radial origin'); vector(radial.factors, 'radial factors'); }
  }
  if (policy.finishes) {
    const finishes = policy.finishes; keys(finishes, ['eligibleSources', 'groups', 'sourceRoles'], 'presentationPolicy.finishes'); requireValue(Array.isArray(finishes.eligibleSources), 'finishes.eligibleSources must be an array.'); finishes.eligibleSources.forEach(source => text(source, 'eligible finish source', 200));
    for (const [key, value] of Object.entries(finishes.groups || {})) { groupId(key, 'finishes.groups'); keys(value, ['family', 'basis'], 'group finish'); family(value.family); text(value.basis, 'finish basis'); }
    if (finishes.sourceRoles) { const roles = finishes.sourceRoles; keys(roles, ['group', 'basis', 'families'], 'finishes.sourceRoles'); groupId(roles.group, 'finishes.sourceRoles'); text(roles.basis, 'finish role basis'); requireValue(plain(roles.families), 'finish role families must be an object.'); Object.values(roles.families).forEach(family); }
  }
  if (policy.navigationIcons) {
    requireValue(plain(policy.navigationIcons), 'navigationIcons must be an object.');
    const icons = new Set(['cube', 'layers', 'window', 'handle', 'gear', 'linkages', 'latch', 'linework']);
    for (const [key, value] of Object.entries(policy.navigationIcons)) { requireValue(ids.has(key), `navigationIcons references an unknown component: ${key}`); requireValue(icons.has(value), `Unsupported navigation icon: ${value}`); }
  }
}

async function validateLineAssets(assets, metadata, label) {
  const hash = bytes => createHash('sha256').update(bytes).digest('hex'), modelHash = hash(await readFile(assets.model));
  for (const [asset, metadataAsset, payload, stride] of [['edges', 'edgeMetadata', 'edges', 24], ['silhouettes', 'silhouetteMetadata', 'contours', 16]]) {
    if (!assets[asset] && !assets[metadataAsset]) continue;
    requireValue(assets[asset] && assets[metadataAsset], `${label}: ${asset} and ${metadataAsset} must be provided together.`);
    const bytes = await readFile(assets[asset]), records = JSON.parse(await readFile(assets[metadataAsset], 'utf8'));
    requireValue(records.schemaVersion === 1 && plain(records.meshes), `${label}: ${metadataAsset} needs schemaVersion 1 and mesh records.`);
    requireValue(records.source?.sha256 === modelHash, `${label}: ${metadataAsset} belongs to a different model asset. Rebuild the package.`);
    requireValue(records[payload]?.sha256 === hash(bytes), `${label}: ${asset} does not match its metadata fingerprint.`);
    for (const part of metadata.parts) {
      const record = records.meshes[part.meshName];
      requireValue(record && Number.isSafeInteger(record.byteOffset) && record.byteOffset >= 0 && record.byteOffset % 4 === 0 && Number.isSafeInteger(record.segmentCount) && record.segmentCount >= 0 && record.byteOffset + record.segmentCount * stride <= bytes.length, `${label}: invalid ${asset} range for ${part.meshName}.`);
      if (asset === 'edges') requireValue(record.vertexCount === record.segmentCount * 2, `${label}: edge vertices do not form segments for ${part.meshName}.`);
    }
  }
}

export function safeURL(value, label = 'URL', { relative = true } = {}) {
  text(value, label, 2048);
  requireValue(!/[\\\u0000-\u0020\u007f]/.test(value) && !value.startsWith('//'), `${label} must be an HTTP(S) URL or a safe relative URL.`);
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    let parsed; try { parsed = new URL(value); } catch { throw new Error(`${label} is not a valid URL.`); }
    requireValue(['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password, `${label} must use HTTP(S) without credentials.`);
  } else {
    requireValue(relative && !value.split(/[/?#]/).includes('..') && !/%(?:2e|2f|5c|0[0-9a-f]|1[0-9a-f])/i.test(value), `${label} must stay within its relative site path.`);
  }
  return value;
}

export async function containedFile(root, base, value, label = 'Asset') {
  text(value, label, 1024);
  requireValue(!path.isAbsolute(value) && !/^[a-z][a-z0-9+.-]*:/i.test(value) && !/[\\?#%\u0000-\u001f]/.test(value), `${label} must be a repository-relative file path.`);
  const rootPath = await realpath(root), resolved = path.resolve(base, value);
  requireValue(resolved.startsWith(rootPath + path.sep), `${label} escapes the repository.`);
  let actual; try { actual = await realpath(resolved); } catch { throw new Error(`${label} does not exist: ${value}`); }
  requireValue(actual.startsWith(rootPath + path.sep), `${label} follows a symlink outside the repository.`);
  return actual;
}

async function packageFile(root, directory, value, label) {
  const actual = await containedFile(root, directory, value, label), boundary = await realpath(directory);
  requireValue(actual.startsWith(boundary + path.sep), `${label} escapes its model package directory.`);
  return actual;
}

export function validateProjectShape(project) {
  keys(project, ['schemaVersion', 'id', 'title', 'description', 'brand', 'defaultModel', 'features', 'models'], 'project');
  requireValue(project.schemaVersion === 1, 'project.schemaVersion must be 1.'); id(project.id, 'project.id');
  text(project.title, 'project.title', 120); text(project.description, 'project.description', 500);
  keys(project.brand, ['name', 'product', 'logo', 'homeUrl', 'accent'], 'project.brand');
  text(project.brand.name, 'project.brand.name', 60); text(project.brand.product, 'project.brand.product', 60);
  safeURL(project.brand.homeUrl, 'project.brand.homeUrl');
  requireValue(/^#[a-f0-9]{6}$/i.test(project.brand.accent), 'project.brand.accent must be a six-digit hex color.');
  if (project.brand.logo !== undefined) safeURL(project.brand.logo, 'project.brand.logo');
  id(project.defaultModel, 'project.defaultModel');
  keys(project.features, ['explode', 'operation', 'tour', 'themes', 'quality', 'renderStyles'], 'project.features');
  for (const flag of ['explode', 'operation', 'tour', 'themes', 'quality']) requireValue(typeof project.features[flag] === 'boolean', `project.features.${flag} must be a boolean.`);
  requireValue(Array.isArray(project.features.renderStyles) && project.features.renderStyles.length > 0 && project.features.renderStyles.every(style => STYLES.includes(style)) && new Set(project.features.renderStyles).size === project.features.renderStyles.length, 'project.features.renderStyles must be a nonempty unique list of engineering, linework and/or flat.');
  requireValue(Array.isArray(project.models) && project.models.length > 0 && project.models.length <= 50, 'project.models must contain between 1 and 50 prepared packages.');
  for (const item of project.models) { keys(item, ['manifest'], 'project.models entry'); text(item.manifest, 'model manifest path', 1024); }
  return project;
}

function readGLB(buffer, metadata, label) {
  requireValue(buffer.length >= 20 && buffer.readUInt32LE(0) === 0x46546c67 && buffer.readUInt32LE(4) === 2 && buffer.readUInt32LE(8) === buffer.length && buffer.readUInt32LE(16) === 0x4e4f534a, `${label}: expected a complete GLB 2.0 prepared asset.`);
  const size = buffer.readUInt32LE(12); requireValue(20 + size <= buffer.length, `${label}: incomplete GLB JSON chunk.`);
  let gltf; try { gltf = JSON.parse(buffer.subarray(20, 20 + size).toString()); } catch { throw new Error(`${label}: invalid GLB JSON.`); }
  requireValue(!(gltf.skins?.length) && !(gltf.nodes || []).some(node => node.skin !== undefined) && !(gltf.meshes || []).some(mesh => mesh.primitives?.some(primitive => primitive.targets?.length)), `${label}: this runtime supports rigid prepared assemblies, not skinning or morph targets.`);
  requireValue(!(gltf.buffers || []).some(buffer => buffer.uri) && !(gltf.images || []).some(image => image.uri), `${label}: external GLB resources must be embedded before configuration.`);
  const names = new Set((gltf.nodes || []).filter(node => node.mesh !== undefined).map(node => PropertyBinding.sanitizeNodeName(node.name || gltf.meshes?.[node.mesh]?.name || `mesh_${node.mesh}`)));
  for (const part of metadata.parts) requireValue(names.has(part.meshName), `${label}: metadata mesh ${part.meshName} is absent from the GLB.`);
  if (metadata.operation) requireValue((gltf.animations || []).some(clip => clip.name === metadata.operation.clipName), `${label}: operating clip ${metadata.operation.clipName} is absent from the GLB.`);
  return gltf;
}

export function validateTour(definition, hierarchy, metadata, label = 'tour') {
  requireValue(plain(definition) && typeof definition.id === 'string' && definition.id && Array.isArray(definition.chapters) && definition.chapters.length > 0, `${label}: an authored tour needs an id and chapters.`);
  text(definition.title, `${label}.title`, 200);
  let elapsed = 0; const chapterIds = new Set();
  const node = (value, field) => requireValue(typeof value === 'string' && hierarchy.nodes.has(value), `${label}: ${field} references an unknown component: ${value}`);
  const presentation = (frame, partial = false) => {
    for (const field of ['scopeId', 'selectedId']) if (!partial || frame[field] !== undefined) node(frame[field], field);
    if (!partial || frame.renderStyle !== undefined) requireValue(STYLES.includes(frame.renderStyle), `${label}: unknown rendering style.`);
    if (!partial || frame.highlightIds !== undefined) { requireValue(Array.isArray(frame.highlightIds), `${label}: highlightIds must be an array.`); frame.highlightIds.forEach(value => node(value, 'highlightIds')); }
    if (!partial || frame.annotations !== undefined) { requireValue(Array.isArray(frame.annotations), `${label}: annotations must be an array.`); frame.annotations.forEach(annotation => { node(annotation.nodeId, 'annotation'); text(annotation.label, `${label} annotation label`, 160); }); }
    if (!partial || frame.camera !== undefined) { requireValue(plain(frame.camera) && finiteVector(frame.camera.direction) && Math.hypot(...frame.camera.direction) > 0, `${label}: camera needs a nonzero finite direction.`); node(frame.camera.focusId, 'camera.focusId'); if (frame.camera.explosion !== undefined) requireValue(fraction(frame.camera.explosion), `${label}: camera explosion must be a fraction.`); if (frame.camera.scale !== undefined) requireValue(Number.isFinite(frame.camera.scale) && frame.camera.scale > 0, `${label}: camera scale must be positive.`); }
  };
  const chapters = definition.chapters.map(chapter => {
    requireValue(typeof chapter.id === 'string' && chapter.id && !chapterIds.has(chapter.id), `${label}: chapter IDs must be unique.`); chapterIds.add(chapter.id);
    requireValue(Number.isFinite(chapter.duration) && chapter.duration > 0, `${label}: chapter duration must be positive.`);
    for (const field of ['previewAt', 'settledAt', 'transitionStart']) if (chapter[field] !== undefined) requireValue(Number.isFinite(chapter[field]) && chapter[field] >= 0 && chapter[field] <= chapter.duration, `${label}: ${field} is outside its chapter.`);
    if (chapter.transition !== undefined) requireValue(Number.isFinite(chapter.transition) && chapter.transition > 0, `${label}: transition must be positive.`);
    requireValue(Array.isArray(chapter.explosion) && chapter.explosion.length === 2 && chapter.explosion.every(fraction), `${label}: explosion needs two fractions.`);
    text(chapter.title, `${label} chapter title`, 200); requireValue(typeof chapter.caption === 'string' && chapter.caption.length <= 1000, `${label}: caption must be a short string.`); presentation(chapter);
    let lastCue = -1;
    for (const cue of chapter.cues || []) { requireValue(Number.isFinite(cue.at) && cue.at >= lastCue && cue.at >= 0 && cue.at <= chapter.duration, `${label}: cues must be ordered within their chapter.`); lastCue = cue.at; presentation(cue, true); }
    if (chapter.operation) {
      const operation = chapter.operation;
      requireValue(metadata.operation && operation.clipName === metadata.operation.clipName && operation.sourceDuration === metadata.operation.duration, `${label}: operating chapters must refer to the package's source clip and duration.`);
      requireValue(fraction(operation.settledProgress) && Array.isArray(operation.passes) && operation.passes.length, `${label}: operating chapters need a settled progress and authored passes.`);
      for (const pass of operation.passes) {
        requireValue(Number.isFinite(pass.start) && pass.start >= 0 && Number.isFinite(pass.duration) && pass.duration > 0 && pass.start + pass.duration <= chapter.duration && Array.isArray(pass.keyframes) && pass.keyframes.length >= 2, `${label}: invalid operating pass.`);
        let last = -1; for (const key of pass.keyframes) { requireValue(Number.isFinite(key.at) && key.at >= last && key.at >= 0 && key.at <= pass.duration && fraction(key.progress), `${label}: invalid operation keyframe.`); last = key.at; }
      }
    }
    const start = elapsed; elapsed += chapter.duration;
    requireValue(chapter.start === undefined || chapter.start === start, `${label}: chapter start differs from cumulative durations.`);
    requireValue(chapter.end === undefined || chapter.end === elapsed, `${label}: chapter end differs from cumulative durations.`);
    return { ...chapter, start, end: elapsed };
  });
  requireValue(definition.duration === elapsed, `${label}: duration differs from the sum of chapters.`);
  const tour = { ...definition, chapters };
  for (const chapter of chapters) for (const time of [chapter.start, chapter.start + (chapter.previewAt || 0), chapter.end]) {
    const frame = sampleTour(tour, time); requireValue(fraction(frame.explosion) && (frame.operationProgress === null || frame.operationProgress === undefined || fraction(frame.operationProgress)), `${label}: sampling produced an invalid pose.`);
  }
  return tour;
}

export async function loadProject(root, { configPath = 'project.config.json' } = {}) {
  root = await realpath(root);
  const file = await containedFile(root, root, configPath, 'Project configuration');
  const project = validateProjectShape(JSON.parse(await readFile(file, 'utf8'))), models = [], ids = new Set(), warnings = [];
  if (project.brand.logo && !/^https?:/i.test(project.brand.logo)) {
    requireValue(/\.(?:svg|png|jpe?g|webp|avif)$/i.test(project.brand.logo), 'Brand logo must be an SVG, PNG, JPEG, WebP or AVIF image.');
    project.brand.logoFile = await containedFile(root, root, project.brand.logo, 'Brand logo');
  }
  for (const entry of project.models) {
    const manifestPath = await containedFile(root, root, entry.manifest, 'Model manifest'), base = path.dirname(manifestPath);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    keys(manifest, ['schemaVersion', 'id', 'rootId', 'title', 'shortTitle', 'assets', 'view', 'provenance', 'presentationPolicy', 'tour'], entry.manifest);
    requireValue(manifest.schemaVersion === 1, `${entry.manifest}: schemaVersion must be 1.`); id(manifest.id, 'manifest.id');
    requireValue(!ids.has(manifest.id), `Duplicate model ID: ${manifest.id}`); ids.add(manifest.id);
    text(manifest.rootId, 'manifest.rootId', 160); text(manifest.title, 'manifest.title', 160); text(manifest.shortTitle, 'manifest.shortTitle', 80);
    keys(manifest.assets, ASSETS, 'manifest.assets'); requireValue(manifest.assets.model && manifest.assets.metadata, 'manifest.assets requires model and metadata.');
    keys(manifest.view, ['direction', 'normalizedWidth', 'labels', 'facts'], 'manifest.view');
    requireValue(finiteVector(manifest.view.direction) && Math.hypot(...manifest.view.direction) > 0 && Number.isFinite(manifest.view.normalizedWidth) && manifest.view.normalizedWidth > 0, 'manifest.view needs a nonzero direction and positive normalizedWidth.');
    requireValue(Array.isArray(manifest.view.labels) && manifest.view.labels.length === 2, 'manifest.view.labels needs two camera labels.'); manifest.view.labels.forEach(label => text(label, 'camera label', 60));
    if (manifest.view.facts !== undefined) { requireValue(Array.isArray(manifest.view.facts) && manifest.view.facts.length <= 12, 'manifest.view.facts must have at most 12 entries.'); for (const fact of manifest.view.facts) { keys(fact, ['label', 'value'], 'view fact'); text(fact.label, 'fact label', 60); text(fact.value, 'fact value', 120); } }
    keys(manifest.provenance, ['author', 'url', 'license', 'attribution', 'description', 'note'], 'manifest.provenance');
    for (const field of ['author', 'license', 'attribution', 'description', 'note']) text(manifest.provenance[field], `manifest.provenance.${field}`);
    if (manifest.provenance.url) safeURL(manifest.provenance.url, 'manifest.provenance.url', { relative: false });
    requireValue(manifest.presentationPolicy === undefined || plain(manifest.presentationPolicy), 'manifest.presentationPolicy must be declarative JSON.');
    const assets = {}; for (const [key, value] of Object.entries(manifest.assets)) assets[key] = await packageFile(root, base, value, `assets.${key}`);
    const metadata = JSON.parse(await readFile(assets.metadata, 'utf8'));
    validatePackage(metadata, { rootId: manifest.rootId, presentationPolicy: manifest.presentationPolicy });
    validatePolicy(manifest.presentationPolicy, metadata, manifest.rootId);
    readGLB(await readFile(assets.model), metadata, manifest.id);
    for (const [compressed, original] of [['compressedModel', 'model'], ['compressedEdges', 'edges'], ['compressedSilhouettes', 'silhouettes']]) if (assets[compressed]) {
      requireValue(assets[original], `${manifest.id}: ${compressed} needs its uncompressed ${original} asset.`);
      let decoded; try { decoded = gunzipSync(await readFile(assets[compressed])); } catch { throw new Error(`${manifest.id}: ${compressed} is not a valid gzip asset.`); }
      requireValue(decoded.equals(await readFile(assets[original])), `${manifest.id}: ${compressed} does not match ${original}. Rebuild the prepared package.`);
    }
    await validateLineAssets(assets, metadata, manifest.id);
    const hierarchy = buildHierarchy(metadata, manifest.presentationPolicy);
    const tourPath = manifest.tour ? await packageFile(root, base, manifest.tour, 'Tour file') : null;
    const tour = tourPath ? validateTour(JSON.parse(await readFile(tourPath, 'utf8')), hierarchy, metadata, `${manifest.id} tour`) : null;
    const linework = ['edges', 'edgeMetadata', 'silhouettes', 'silhouetteMetadata'].every(key => assets[key]);
    requireValue(!project.features.renderStyles.some(style => style !== 'engineering') || linework, `${manifest.id}: enabled line treatments require prepared edges, edge metadata, silhouettes and silhouette metadata.`);
    const runtime = { id: manifest.id, packageId: manifest.id, rootId: manifest.rootId, title: manifest.title, shortTitle: manifest.shortTitle,
      capabilities: { operation: Boolean(metadata.operation), renderStyles: linework ? STYLES : ['engineering'] }, operationClipId: metadata.operation?.clipName || null, presentationPolicy: manifest.presentationPolicy || {}, tour,
      defaultDirection: manifest.view.direction, normalizeWidth: manifest.view.normalizedWidth, viewLabels: manifest.view.labels, facts: manifest.view.facts || [],
      attribution: manifest.provenance.attribution, sourceUrl: manifest.provenance.url || null, sourceLabel: 'View model source', sourceDescription: manifest.provenance.description, sourceNote: manifest.provenance.note };
    const hash = createHash('sha256').update(canonical(manifest));
    for (const [key, asset] of Object.entries(assets).sort(([a], [b]) => a.localeCompare(b))) hash.update(key).update(await readFile(asset));
    if (tourPath) hash.update('tour').update(await readFile(tourPath));
    runtime.revision = `sha256:${hash.digest('hex')}`;
    if (tour && project.features.tour && featurePolicy(project, runtime).tours.length === 0) warnings.push(`${manifest.id}: guided tour is disabled because it requires a disabled project capability.`);
    models.push({ manifest, manifestPath, metadata, tour, assets, revision: runtime.revision, runtime });
  }
  requireValue(ids.has(project.defaultModel), `defaultModel ${project.defaultModel} is not included in project.models.`);
  return { project, models, warnings };
}
