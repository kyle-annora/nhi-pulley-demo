import {defineConfig} from 'vite';
import {readFile} from 'node:fs/promises';

export default defineConfig({
  base:'./',publicDir:false,
  plugins:[{name:'redistribution-notices',async generateBundle(){
    const files=[['Annora Explorer','LICENSE'],['Three.js','node_modules/three/LICENSE'],['Original illustrative F-4412 geometry','source/LICENSE']];
    const notices=await Promise.all(files.map(async([name,file])=>`${name}\n${'='.repeat(name.length)}\n\n${await readFile(new URL(file,import.meta.url),'utf8')}`));
    this.emitFile({type:'asset',fileName:'LICENSES.txt',source:notices.join('\n\n')});
  }}],
  build:{assetsInlineLimit:0,chunkSizeWarningLimit:750,rollupOptions:{output:{manualChunks:id=>id.includes('/node_modules/three/')?'three':undefined}}},
});
