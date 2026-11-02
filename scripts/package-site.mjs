import {cp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';

const output=resolve('_site');
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
await cp('index.html',resolve(output,'workspace.html'));
await cp('patrick.html',resolve(output,'patrick.html'));
for(const path of ['capability-preview','presentation-kit','assets','shared-explorer/dist','docs/presentation/patrick-talk-track.md','docs/mobile-refinements.md','docs/components/shadcn-upstream.json','THIRD-PARTY-NOTICES.md','DESIGN.md']){
  await mkdir(resolve(output,path,'..'),{recursive:true});
  await cp(path,resolve(output,path),{recursive:true});
}
// The normal workspace is preserved for Patrick's existing-records entrance.
// Query/hash links from that application continue through the root dispatcher.
const landing=`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NHI · Pulley demonstration</title><meta name="description" content="An illustrative F-4412 pulley, inquiry and quotation demonstration by Annora."></head>
<body><p><a href="./patrick.html">Open the NHI pulley demonstration</a></p><p><a href="./workspace.html?sample=1#quote">Open the example workspace</a></p>
<script>const target=location.search||location.hash?'workspace.html':'patrick.html';location.replace(new URL('./'+target+location.search+location.hash,location.href));</script></body></html>`;
await writeFile(resolve(output,'index.html'),landing);
await writeFile(resolve(output,'.nojekyll'),'');
let commit='uncommitted';
try{commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
await writeFile(resolve(output,'build-info.json'),JSON.stringify({sourceCommit:commit,builtAt:new Date().toISOString(),entry:'patrick.html',exampleOnly:true},null,2)+'\n');
const pkg=JSON.parse(await readFile('package.json','utf8'));
console.log(`Packaged ${pkg.name} in _site/ with Patrick opening and preserved workspace links.`);
