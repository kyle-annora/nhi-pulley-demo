#!/usr/bin/env node
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IMPORT_LIMITS, prepareModelPackage, validateDefinition } from './lib/model-preparation.mjs';

const HELP=`Prepare a source-preserving Explorer model package.

npm run import:model -- --source <model.glb> --definition <definition.json> --out content/models/<id>

Required definition fields:
  schemaVersion: 1; id; title; provenance: {author, license, attribution, description, note}
  licenseFile: a definition-relative notice file, OR licenseText: its exact text
Optional:
  rootId, shortTitle, provenance.url (HTTP/S), view: {direction, normalizedWidth, labels}
  groups: [{id, title, meshNames, description?, explode?, finishFamily?, children?}]
  parts: {exactLoadedMeshName: {id?, title?, description?, explode?, finishFamily?}}
  operation: {clipName, stages: [{at, title, description?, nodeId?}]}
  tour: a definition-relative authored tour JSON; creaseAngle; presentationPolicy

Source limit: 64 MiB; 2,000 rigid meshes; 1,000,000 referenced triangles;
250,000 triangles per geometry; 3,000,000 referenced vertices; 192 MiB output.
Use uniquely named, uncompressed, untextured, single-material rigid triangle meshes.
Sparse/interleaved/compressed/skinned/morphed geometry, external resources,
non-manifold edges, shear and scale animation are unsupported. Source CAD must be
converted first. Motion and tour narratives are never invented by the importer.

The output directory must not exist. Preparation completes and validates in memory
before a temporary sibling directory is written and atomically renamed into place.
No source file is edited, and no project/runtime registration is changed.
`;

async function absent(path){try{await lstat(path);return false;}catch(error){if(error.code==='ENOENT')return true;throw error;}}
async function readBounded(path,limit,label){const info=await stat(path);if(!info.isFile()||info.size>limit)throw new Error(`${label} must be a regular file no larger than ${limit} bytes.`);return readFile(path);}
async function referencedFile(base,value,label){
  if(typeof value!=='string'||!value||isAbsolute(value))throw new Error(`${label} must be a relative filename inside the definition folder.`);
  const baseReal=await realpath(base),target=await realpath(resolve(base,value)),within=relative(baseReal,target);
  if(within==='..'||within.startsWith('..'+sep)||isAbsolute(within))throw new Error(`${label} must stay inside the definition folder, including symlink targets.`);
  return readBounded(target,1024*1024,label);
}
function utf8(bytes,label){try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error(`${label} must be valid UTF-8 text.`);}}
function parse(bytes,label){try{return JSON.parse(utf8(bytes,label));}catch(error){throw new Error(`${label} is not valid UTF-8 JSON: ${error.message}`);}}

export async function importModel({source,definition:definitionPath,out}){
  if(!source||!definitionPath||!out)throw new Error('Provide --source, --definition and --out. See --help.');
  const target=resolve(out);if(!await absent(target))throw new Error('Output already exists. Choose a new package directory; the importer never overwrites one.');
  const definition=validateDefinition(parse(await readBounded(resolve(definitionPath),1024*1024,'Definition'),'Definition'));
  const base=dirname(resolve(definitionPath));
  const licenseText=definition.licenseText??utf8(await referencedFile(base,definition.licenseFile,'License notice'),'License notice');
  const tour=definition.tour?parse(await referencedFile(base,definition.tour,'Authored tour'),'Authored tour'):undefined;
  const prepared=await prepareModelPackage({sourceBytes:await readBounded(resolve(source),IMPORT_LIMITS.sourceBytes,'Source GLB'),definition,licenseText,tour});
  // No output directory or temporary asset is created before preparation succeeds.
  await mkdir(dirname(target),{recursive:true});let temporary=await mkdtemp(resolve(dirname(target),`.${basename(target)}.import-`));
  try{
    await Promise.all([...prepared.files].map(([name,bytes])=>writeFile(resolve(temporary,name),bytes,{flag:'wx'})));
    if(!await absent(target))throw new Error('Output appeared during preparation. Nothing was overwritten; choose a new directory.');
    await rename(temporary,target);temporary=null;
  }finally{if(temporary)await rm(temporary,{recursive:true,force:true});}
  return {...prepared.report,output:target};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const args=process.argv.slice(2);if(args.includes('--help')||args.includes('-h')){process.stdout.write(HELP);}
    else{
      const options={};for(let index=0;index<args.length;index+=2){const key=args[index];if(!['--source','--definition','--out'].includes(key)||!args[index+1]||args[index+1].startsWith('--')||options[key.slice(2)])throw new Error('Unknown, duplicated or incomplete CLI argument. See --help.');options[key.slice(2)]=args[index+1];}
      const report=await importModel(options);process.stdout.write(JSON.stringify(report,null,2)+'\n');
    }
  }catch(error){process.stderr.write(`Import failed: ${error.message}\n`);process.exitCode=1;}
}
