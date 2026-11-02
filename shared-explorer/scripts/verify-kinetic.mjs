import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { AnimationMixer, Box3, EdgesGeometry, Vector3 } from 'three';
import { KINETIC_SOURCE, kineticDirectory, loadKineticAsset, sha256 } from './kinetic-asset.mjs';

export async function verifyKineticAsset() {
  const { bytes, gltf, meshes } = await loadKineticAsset();
  const read = name => readFile(resolve(kineticDirectory, name));
  const metadata = JSON.parse(await read('metadata.json'));
  const edges = JSON.parse(await read('edge-metadata.json'));
  const edgeBytes = await read('edges.bin');
  const modelGzip = await read('model.glb.gz'), edgeGzip = await read('edges.bin.gz');
  assert.equal(sha256(bytes), KINETIC_SOURCE.sha256, 'Original downloaded animation asset must remain byte-identical.');
  assert.equal(sha256(await read('LICENSE')), KINETIC_SOURCE.licenseSha256);
  assert.equal(sha256(await read('source/build_scene.py')), KINETIC_SOURCE.generatorSha256);
  assert.deepEqual(gunzipSync(modelGzip), bytes);
  assert.deepEqual(gunzipSync(edgeGzip), edgeBytes);
  assert.equal(modelGzip.readUInt32LE(4), 0, 'Gzip must be deterministic.');
  assert.equal(edgeGzip.readUInt32LE(4), 0);
  assert.equal(meshes.length, 107);
  assert.equal(metadata.stats.meshCount, 107);
  assert.equal(gltf.parser.json.nodes.length, 114);
  assert.equal(metadata.stats.nodeCount, 114);
  assert.equal(metadata.stats.bytes, bytes.length);
  assert.equal(metadata.stats.gzipBytes, modelGzip.length);
  assert.equal(metadata.source.sha256, KINETIC_SOURCE.sha256);
  const loadedNames = new Set(meshes.map(mesh => mesh.name));
  assert.equal(loadedNames.size, meshes.length);
  assert.deepEqual(new Set(metadata.parts.map(part => part.meshName)), loadedNames);
  assert.deepEqual(new Set(Object.keys(edges.meshes)), loadedNames);
  const allMembers = metadata.groups.flatMap(group => group.meshNames);
  assert.equal(allMembers.length, 107);
  assert.equal(new Set(allMembers).size, 107, 'Presentation groups must partition the source meshes.');
  assert.deepEqual(new Set(allMembers), loadedNames);
  const families = new Set(['structure', 'satin', 'machined', 'polished', 'polymer', 'glass', 'bronze', 'indicator']);
  const byName = new Map(meshes.map(mesh => [mesh.name, mesh]));
  for (const part of metadata.parts) {
    assert(families.has(part.finishFamily));
    assert(part.explode.every(Number.isFinite));
    const mesh = byName.get(part.meshName);
    assert.equal(gltf.parser.associations.get(mesh).nodes, part.sourceNodeIndex);
    assert.equal(gltf.parser.json.nodes[part.sourceNodeIndex].name, part.sourceName);
    assert(metadata.groups.find(group => group.id === part.group)?.meshNames.includes(part.meshName));
    const box = new Box3().setFromObject(mesh);
    assert.deepEqual([box.min.toArray(), box.max.toArray()], part.bounds);
  }

  assert.equal(gltf.animations.length, 1);
  const clip = gltf.animations[0];
  assert.equal(clip.name, 'Animation');assert.equal(clip.duration, 4);assert.equal(clip.tracks.length, 4);
  assert.deepEqual(new Set(clip.tracks.map(track => track.name)), new Set([
    'Connecting_Rod_Pose.position', 'Connecting_Rod_Pose.quaternion',
    'Crank_Rotation.quaternion', 'Slider_Translation.position'
  ]));
  for (const track of clip.tracks) {
    assert.equal(track.times.length, 241);
    assert.equal(track.times[0], 0);assert.equal(track.times.at(-1), 4);
    const size = track.getValueSize(), first = Array.from(track.values.slice(0, size)), last = Array.from(track.values.slice(-size));
    if (size === 4) {
      assert(Math.abs(first.reduce((dot, value, index) => dot + value * last[index], 0)) > 1 - 1e-6, 'Loop rotation endpoints must describe the same orientation.');
    } else first.forEach((value, index) => assert(Math.abs(value - last[index]) < 1e-6, 'Loop translation endpoints must match.'));
  }

  // Independently inspect the loaded animation at quarter-frame intervals.
  // This checks the delivered tracks, not a replacement runtime solver.
  const mixer = new AnimationMixer(gltf.scene);mixer.clipAction(clip).play();
  const center = gltf.scene.getObjectByName('Crank_Center');
  const pin = gltf.scene.getObjectByName('Crank_Pin');
  const slider = gltf.scene.getObjectByName('Slider_Pin');
  const rod = gltf.scene.getObjectByName('Connecting_Rod_Pose');
  const c = new Vector3(), p = new Vector3(), q = new Vector3();
  const envelopes = new Map(metadata.parts.map(part => [part.meshName, new Box3(new Vector3(...part.cycleBounds[0]), new Vector3(...part.cycleBounds[1]))]));
  let maximumPinGap = 0, maximumPathError = 0, minimumSlider = Infinity, maximumSlider = -Infinity;
  for (let sample = 0; sample <= 960; sample++) {
    const t = sample / 240, theta = Math.PI * 2 * t / 4;
    mixer.setTime(t);gltf.scene.updateMatrixWorld(true);
    center.getWorldPosition(c);pin.getWorldPosition(p);slider.getWorldPosition(q);
    const expectedPin = new Vector3(-.09 + .035 * Math.cos(theta), .102, -.035 * Math.sin(theta));
    const expectedSlider = new Vector3(expectedPin.x + Math.sqrt(.11 ** 2 - expectedPin.z ** 2), .102, 0);
    const rodStart = rod.localToWorld(new Vector3()), rodEnd = rod.localToWorld(new Vector3(.11, 0, 0));
    maximumPinGap = Math.max(maximumPinGap, rodStart.distanceTo(p), rodEnd.distanceTo(q));
    maximumPathError = Math.max(maximumPathError, p.distanceTo(expectedPin), q.distanceTo(expectedSlider));
    minimumSlider = Math.min(minimumSlider, q.x);maximumSlider = Math.max(maximumSlider, q.x);
    assert(c.distanceTo(new Vector3(-.09, .102, 0)) < 1e-7, 'Crank center must remain fixed.');
    assert(Math.abs(p.distanceTo(c) - .035) < 1e-7, 'Crank radius must stay constant.');
    assert(Math.abs(p.distanceTo(q) - .11) < 1e-5, 'Connecting rod pin spacing must stay within 0.01 mm.');
    assert(Math.abs(q.z) < 1e-7 && Math.abs(q.y - .102) < 1e-7, 'Slider must remain on the fixed guide.');
    for (const mesh of meshes) assert(envelopes.get(mesh.name).containsBox(new Box3().setFromObject(mesh)), `Sampled component escaped its operating envelope: ${mesh.name}`);
  }
  assert(maximumPinGap < 1e-5, 'Source animation rod/pin gap exceeds 0.01 mm.');
  assert(maximumPathError < 1e-5, 'Source animation differs from its declared kinematics by more than 0.01 mm.');
  assert(Math.abs(maximumSlider - minimumSlider - .07) < 1e-7, 'Stroke must be 70 mm.');

  assert.equal(edges.source.sha256, KINETIC_SOURCE.sha256);
  assert.equal(edges.edges.sha256, sha256(edgeBytes));
  assert.equal(edges.edges.coordinates, 'mesh-local');assert.equal(edges.edges.creaseAngle, 25);
  assert.equal(edges.stats.bytes, edgeBytes.length);assert.equal(edges.stats.gzipBytes, edgeGzip.length);
  for (const name of ['Base_|_cobalt_plinth', 'Connecting_rod', 'Crank_arm', 'Crank_balance_disk', 'Orange_slider_carriage', 'Linear_guide_rail']) {
    assert(edges.meshes[name].segmentCount >= 24, `Technical mode lost the beveled body outline: ${name}`);
  }
  let triangles = 0, segments = 0, cursor = 0;
  for (const geometry of edges.geometries) {
    assert.equal(geometry.byteOffset, cursor);cursor += geometry.vertexCount * 12;
    assert.equal(geometry.edgeSha256, sha256(edgeBytes.subarray(geometry.byteOffset, cursor)));
  }
  assert.equal(cursor, edgeBytes.length);
  for (const mesh of meshes) {
    const record = edges.meshes[mesh.name], actual = new EdgesGeometry(mesh.geometry, 25);
    const values = actual.attributes.position.array;
    assert.equal(actual.attributes.position.count, record.vertexCount);
    for (let i = 0; i < values.length; i++) assert.equal(edgeBytes.readFloatLE(record.byteOffset + i * 4), values[i], `Crease geometry mismatch: ${mesh.name}`);
    triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
    segments += record.segmentCount;actual.dispose();
  }
  assert.equal(triangles, metadata.stats.triangles);assert.equal(triangles, edges.stats.triangles);
  assert.equal(segments, edges.stats.referencedSegments);
  return { sourceSha256: KINETIC_SOURCE.sha256, meshes: meshes.length, triangles, animationSeconds: clip.duration, sampledPoses: 961, maximumPinGapMm: maximumPinGap * 1000, maximumPathErrorMm: maximumPathError * 1000, strokeMm: (maximumSlider - minimumSlider) * 1000, creaseSegments: segments, gzipModelBytes: modelGzip.length, gzipEdgeBytes: edgeGzip.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(await verifyKineticAsset(), null, 2));
