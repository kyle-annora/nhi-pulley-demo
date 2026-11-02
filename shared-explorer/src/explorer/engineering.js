import * as THREE from 'three';

/** One neutral studio, baked once. Broad reflections describe curvature; the
 * narrower strip separates polished hardware from rough structural surfaces.
 * World-space lights stay fixed during orbit, separation and authored motion. */
export const STUDIO_PANELS = Object.freeze([
  { position: [-4, 5, 4], size: [7, 5], radiance: 5.0 },
  { position: [5, 2, -3], size: [2, 8], radiance: 6.0 },
  { position: [-5, 0, -4], size: [4, 6], radiance: 2.4 },
  { position: [0, 7, -1], size: [7, 5], radiance: 2.0 },
  { position: [1, -2, 6], size: [5, 3], radiance: 1.2 }
].map(panel => Object.freeze({ ...panel, position: Object.freeze(panel.position), size: Object.freeze(panel.size) })));

/** Soft panel edges are prefiltered into the PMREM, never animated noise. */
export function createPanelTexture(size = 64) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const edge = Math.min(x, y, size - x - 1, size - y - 1) / (size * .18);
    const t = THREE.MathUtils.clamp(edge, 0, 1), value = Math.round(255 * (.025 + .975 * t * t * (3 - 2 * t)));
    data.set([value, value, value, 255], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createEngineeringEnvironment(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color().setScalar(.14);
  const geometry = new THREE.PlaneGeometry(), texture = createPanelTexture();
  const materials = [];
  for (const panel of STUDIO_PANELS) {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(panel.radiance), map: texture, side: THREE.DoubleSide, toneMapped: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...panel.position); mesh.scale.set(...panel.size, 1); mesh.lookAt(0, 0, 0);
    materials.push(material); scene.add(mesh);
  }
  let generator;
  try { generator = new THREE.PMREMGenerator(renderer); return generator.fromScene(scene, .02, .1, 100, { size: 256 }); }
  finally { generator?.dispose(); geometry.dispose(); texture.dispose(); materials.forEach(material => material.dispose()); }
}

export function createEngineeringLights() {
  const rig = new THREE.Group();
  rig.add(new THREE.HemisphereLight(0xffffff, 0x343434, .35));
  for (const [intensity, position] of [[2.0, [-4, 6, 7]], [.65, [5, 1, 2]], [1.1, [2, 4, -5]]]) {
    const light = new THREE.DirectionalLight(0xffffff, intensity);
    light.position.set(...position); rig.add(light);
  }
  return rig;
}

/** Opaque PBR keeps deep assemblies deterministic and avoids transmission passes.
 * Smoked glazing is a reflective finish approximation, not optical simulation. */
export function createEngineeringMaterial(spec) {
  return new THREE.MeshStandardMaterial({
    color: spec.color, metalness: spec.metalness, roughness: spec.roughness,
    side: THREE.DoubleSide, envMapIntensity: 1
  });
}
