#!/usr/bin/env node
import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateReleasePackage } from '../src/studio/domain.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

/** Apply a reviewed static content release. This never deploys or alters customer records. */
export async function applyRoomRelease(packet, { root = projectRoot, replace = false } = {}) {
  const issues = validateReleasePackage(packet).filter(item => item.severity === 'error');
  if (issues.length) throw new Error(issues.map(item => `${item.path}: ${item.message}`).join('\n'));
  const release = structuredClone(packet.release);
  if (release.productId !== 'kinetic-01') throw new Error('This Studio release supports the prepared crank product only.');
  release.source = 'bundled';
  const target = resolve(root, 'content/rooms/kinetic-01/release.json');
  let current = null;
  try { current = JSON.parse(await readFile(target, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (current && JSON.stringify(current) === JSON.stringify(release)) return { target, changed: false, releaseId: release.id };
  if (current?.id === release.id) throw new Error('This release identity already names different content. Publish a new version instead of rewriting a released snapshot.');
  if (current && !replace) throw new Error('A bundled Room release already exists. Review the change, then pass --replace to apply it.');
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(release, null, 2) + '\n', { flag: 'wx' });
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
  return { target, changed: true, releaseId: release.id };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: npm run apply:room-release -- --file <reviewed-release.json> [--replace]\nApplies content only. Run npm run verify, review the diff, then commit and push to deploy.');
    return;
  }
  const fileAt = args.indexOf('--file');
  const allowed = args.filter((_, index) => index !== fileAt && index !== fileAt + 1);
  if (fileAt < 0 || !args[fileAt + 1] || allowed.some(arg => arg !== '--replace')) throw new Error('Use --file <reviewed-release.json> and optional --replace.');
  const packet = JSON.parse(await readFile(resolve(args[fileAt + 1]), 'utf8'));
  const result = await applyRoomRelease(packet, { replace: args.includes('--replace') });
  console.log(`${result.changed ? 'Applied' : 'Already applied'} Room release ${result.releaseId}.\nNo deployment has run. Next: npm run verify, review the content diff, then commit and push through the existing GitHub workflow.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
