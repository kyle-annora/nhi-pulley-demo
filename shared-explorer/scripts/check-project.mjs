#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadProject } from './lib/project-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sha = buffer => createHash('sha256').update(buffer).digest('hex');

try {
  const { project, models, warnings } = await loadProject(root);
  for (const model of models) {
    const { manifest, assets, metadata } = model;
    assert(assets.license && (await readFile(assets.license, 'utf8')).trim(), `${manifest.id}: a nonempty license file is required for publication.`);
    const source = await readFile(assets.model), sourceHash = sha(source);
    const counts = {};
    for (const [binaryKey, metadataKey, section, stride] of [['edges', 'edgeMetadata', 'edges', 24], ['silhouettes', 'silhouetteMetadata', 'contours', 16]]) {
      if (!assets[binaryKey] && !assets[metadataKey]) continue;
      assert(assets[binaryKey] && assets[metadataKey], `${manifest.id}: ${binaryKey} and its metadata must be declared together.`);
      const data = await readFile(assets[binaryKey]), descriptor = JSON.parse(await readFile(assets[metadataKey], 'utf8'));
      assert(descriptor.source?.sha256 === sourceHash, `${manifest.id}: ${binaryKey} were prepared from different source bytes.`);
      assert(descriptor[section]?.sha256 === sha(data), `${manifest.id}: ${binaryKey} integrity mismatch.`);
      assert(descriptor.stats?.bytes === data.length, `${manifest.id}: ${binaryKey} byte count differs from its descriptor.`);
      assert(Array.isArray(descriptor.geometries) && descriptor.meshes && typeof descriptor.meshes === 'object', `${manifest.id}: missing ${binaryKey} ranges.`);
      const checkRange = range => assert(Number.isSafeInteger(range.byteOffset) && range.byteOffset >= 0 && range.byteOffset % 4 === 0 && Number.isSafeInteger(range.segmentCount) && range.segmentCount >= 0 && range.byteOffset + range.segmentCount * stride <= data.length, `${manifest.id}: invalid ${binaryKey} range.`);
      for (const range of descriptor.geometries) {
        checkRange(range);
        const expected = section === 'edges' ? range.edgeSha256 : range.sha256;
        assert(expected === sha(data.subarray(range.byteOffset, range.byteOffset + range.segmentCount * stride)), `${manifest.id}: ${binaryKey} geometry checksum differs.`);
      }
      for (const part of metadata.parts) {
        const range = descriptor.meshes[part.meshName];
        assert(range, `${manifest.id}: ${binaryKey} omit ${part.meshName}.`); checkRange(range);
      }
      counts[binaryKey] = data.length;
    }
    const compressed = assets.compressedModel ? (await readFile(assets.compressedModel)).length : source.length;
    console.log(`${manifest.id}: ${metadata.parts.length} meshes; model ${(compressed / 1024).toFixed(1)} KiB transfer; derived ${((Object.values(counts).reduce((sum, value) => sum + value, 0)) / 1024).toFixed(1)} KiB raw; ${model.revision.slice(0, 23)}`);
    if (compressed > 5 * 1024 * 1024) warnings.push(`${manifest.id}: large model download. Keep optional and measure representative devices before a performance commitment.`);
  }
  for (const warning of warnings) console.warn(`Warning: ${warning}`);
  console.log(`Project ${project.id}: ${models.length} valid, licensed model package(s).`);
} catch (error) {
  console.error(`Project check failed: ${error.message}`);
  process.exitCode = 1;
}
