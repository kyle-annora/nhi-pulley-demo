import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const kineticDirectory = fileURLToPath(new URL('../content/models/kinetic-01/', import.meta.url));
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const KINETIC_SOURCE = Object.freeze({
  title: 'Kinetic 01 — tabletop crank-slider',
  author: 'Pradeep Kaushik',
  repository: 'https://github.com/pr9868/scene-acceptance',
  commit: 'c361b9ad46f91ba960c708c2510aa204ad45605b',
  path: 'examples/astra-mechanical-assembly/submission/output/crank_slider.glb',
  sha256: '5356cb1e7dcf85874c1f2152795b7011f43f01c2bfc899a5fa75a198687204ad',
  license: 'MIT',
  licenseURL: 'https://github.com/pr9868/scene-acceptance/blob/c361b9ad46f91ba960c708c2510aa204ad45605b/examples/astra-mechanical-assembly/LICENSE',
  licenseSha256: '8f694d23cac4bad2c9f97c5b21f20a891c018445594edc179a39555c17c79728',
  generatorSha256: '58c06fd95e6b9c10cb1fc95eb852cc0b59c9e2a2fe71e8734293da7fdfec7bc9',
  kind: 'Published procedural mechanism study with authored animation; not manufacturer CAD.',
  attribution: 'Kinetic 01 by Pradeep Kaushik, MIT. Original study produced with an AI agent; presentation metadata and technical edges adapted for Annora Explorer.'
});

export async function loadKineticAsset() {
  const bytes = await readFile(new URL('../content/models/kinetic-01/model.glb', import.meta.url));
  if (sha256(bytes) !== KINETIC_SOURCE.sha256) throw new Error('The source GLB differs from the pinned upstream asset.');
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const meshes = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(node => { if (node.isMesh) meshes.push(node); });
  return { bytes, gltf, meshes };
}

export const KINETIC_GROUPS = Object.freeze([
  { id: 'crank', title: 'Crank drive', description: 'A rotating crank and offset pin provide the rotary input for one complete revolution.' },
  { id: 'rod', title: 'Connecting rod', description: 'The 110 mm link follows the crank pin and transfers its motion to the carriage.' },
  { id: 'carriage', title: 'Slider carriage', description: 'The carriage travels 70 mm along the guide while remaining connected to the rod.' },
  { id: 'guide', title: 'Linear guide', description: 'Two fixed rails guide the carriage; the scale makes its travel visible.' },
  { id: 'frame', title: 'Frame and supports', description: 'The base, spindle bearing and fixed supports establish the reference for the moving mechanism.' }
]);

export function kineticGroup(mesh, sourceName) {
  if (mesh.parent.name === 'Crank_Rotation') return 'crank';
  if (mesh.parent.name === 'Connecting_Rod_Pose') return 'rod';
  if (mesh.parent.name === 'Slider_Translation') return 'carriage';
  if (/^(Guide |Linear guide|Scale tick|Travel scale)/.test(sourceName)) return 'guide';
  return 'frame';
}

export function kineticFinish(sourceName, materialName) {
  if (/bearing bronze seat/i.test(sourceName)) return 'bronze';
  if (/bushing barrel/i.test(sourceName)) return 'bronze';
  if (/bearing seal|Rubber isolator/i.test(sourceName)) return 'polymer';
  if (/hex recess|recessed spine/i.test(sourceName)) return 'machined';
  return {
    'Structure | cobalt enamel': 'structure',
    'Linkage | satin steel': 'satin',
    'Slider | signal orange': 'indicator',
    'Hardware | graphite': 'machined',
    'Hardware | polished alloy': 'polished',
    'Feet | dark rubber': 'polymer',
    'Lettering | ivory': 'satin'
  }[materialName] || 'satin';
}

export function sourceNodePath(source, index) {
  const parents = new Map();
  source.nodes.forEach((node, parent) => (node.children || []).forEach(child => parents.set(child, parent)));
  const parts = [];
  for (let id = index; id !== undefined; id = parents.get(id)) parts.unshift(source.nodes[id].name || `node-${id}`);
  return '/' + parts.join('/');
}
