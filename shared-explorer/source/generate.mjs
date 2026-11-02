/** Original illustrative F-4412 presentation geometry. MIT, Annora 2026.
 * A/B/D match the supplied catalog. All other contours are explanatory.
 * The three mesh groups are inspection regions, never a verified parts list.
 */
import * as THREE from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const here=new URL('./',import.meta.url), root=new THREE.Group();root.name='F4412IllustrativePulley';
const parts={},groups={
  belt:{title:'Belt-running region',description:'Inspection region: catalog B is 2.75 in; catalog D is 0.75 in. Viewing does not confirm belt compatibility.',meshNames:[]},
  flange:{title:'Flange region',description:'Inspection region: catalog A is 3.125 in across the outside edges. Stamped contours are illustrative.',meshNames:[]},
  mount:{title:'Mounting region',description:'Inspection region: the hub and seal shapes are illustrative. Bore, offsets, spacers, speed and load require engineering review.',meshNames:[]},
};
const material=(name,color,metalness,roughness)=>Object.assign(new THREE.MeshStandardMaterial({color,metalness,roughness}),{name});
const materials={satin:material('Satin silver','#b8bebb',.9,.4),machined:material('Dark machined','#737c79',.85,.38),polished:material('Bright hardware','#d0d4d1',.9,.3),polymer:material('Polymer and seals','#29302d',0,.7)};
function lathe(name,profile,region,finish,title){
  const geometry=new THREE.LatheGeometry(profile.map(p=>new THREE.Vector2(...p)),96);
  geometry.rotateX(Math.PI/2);geometry.clearGroups();geometry.normalizeNormals();
  const mesh=new THREE.Mesh(geometry,materials[finish]);mesh.name=name;
  mesh.userData={illustrative:true,inspectionRegion:region};root.add(mesh);
  groups[region].meshNames.push(name);
  parts[name]={id:name.replaceAll('_','-'),title,description:groups[region].description,finishFamily:finish,explode:[0,0,0]};
}
// Source units: inches. A = 3.125, B = 2.75, D = 0.75.
lathe('belt_surface',[[1.375,-.375],[1.375,.375],[1.335,.375],[1.335,-.375],[1.375,-.375]],'belt','machined','Belt-running surface (illustrative)');
const flangeProfile=[[.24,.24],[.4,.24],[.48,.28],[1.1,.28],[1.26,.32],[1.375,.375],[1.54,.375],[1.5625,.39],[1.5625,.425],[1.54,.44],[1.375,.425],[1.25,.37],[1.1,.33],[.48,.33],[.4,.30],[.24,.30],[.24,.24]];
lathe('flange_front',flangeProfile,'flange','satin','Front flange region (illustrative contour)');
lathe('flange_rear',flangeProfile.map(([r,y])=>[r,-y]).reverse(),'flange','satin','Rear flange region (illustrative contour)');
lathe('mounting_hub',[[.1875,-.53],[.24,-.53],[.27,-.49],[.27,.49],[.24,.53],[.1875,.53],[.1875,-.53]],'mount','polished','Illustrative mounting hub');
for(const sign of [-1,1]){
  const profile=[[.27,.305*sign],[.4,.305*sign],[.4,.325*sign],[.27,.325*sign],[.27,.305*sign]];
  lathe(sign===1?'seal_front':'seal_rear',sign===1?profile:profile.reverse(),'mount','polymer',`${sign===1?'Front':'Rear'} illustrative seal region`);
}
root.updateMatrixWorld(true);
const specs=[
  ['belt','Belt contact','Check the belt-running surface.','B = 2.75 in running diameter. D = 0.75 in width between flanges. Compare these with the belt requirement; fit is not established.',[1.6,.7,1.05],1],
  ['flange','Outside diameter','Separate outside diameter from running diameter.','A = 3.125 in across flange edges. B = 2.75 in where the belt runs. Allow for the outside envelope in your application.',[.12,.1,2.2],1],
  ['mount','Mounting','Record what engineering must confirm.','The hub is illustrative. Provide bore, offsets, spacers, speed and load for engineering review. No mounting fit has been verified.',[.42,.23,2.2],1],
];
const chapters=specs.map(([id,label,title,caption,direction,scale],index)=>({id,label,title,caption,duration:2.5,previewAt:0,settledAt:2.5,start:index*2.5,end:(index+1)*2.5,scopeId:'f4412',selectedId:id,highlightIds:[id],renderStyle:'engineering',explosion:[0,0],camera:{focusId:'f4412',direction,scale,explosion:0},annotations:[{nodeId:id,label}],cues:[]}));
const tour={id:'f4412-inspection',title:'Three checks before an F-4412 inquiry',playback:'steps',duration:7.5,chapters};
const definition={schemaVersion:1,id:'f4412',rootId:'f4412',title:'F-4412 · illustrative pulley',shortTitle:'F-4412',provenance:{author:'Annora',license:'MIT',attribution:'Annora · illustrative F-4412 study · MIT · 2026',description:'Original presentation geometry based on the catalog A/B/D dimensions; the hub, seals and stamped contours are reconstructed illustrations.',note:'Not manufacturer CAD. Inspection regions are not a verified BOM. No bore, tolerance, mounting fit, speed, load or operating motion is established.'},licenseFile:'LICENSE',view:{direction:[1.3,.6,1.7],normalizedWidth:4.2,labels:['Overview','Reverse'],facts:[{label:'Catalog A',value:'3.125 in'},{label:'Catalog B',value:'2.75 in'},{label:'Catalog D',value:'0.75 in'}]},creaseAngle:35,groups:Object.entries(groups).map(([id,group])=>({id,...group,explode:[0,0,0]})),parts,tour:'authored-tour.json'};
globalThis.FileReader??=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(value=>{this.result=value;this.onload?.({target:this});this.onloadend?.({target:this});});}readAsDataURL(blob){blob.arrayBuffer().then(value=>{this.result=`data:${blob.type};base64,${Buffer.from(value).toString('base64')}`;this.onloadend?.({target:this});});}};
const glb=Buffer.from(await new GLTFExporter().parseAsync(root,{binary:true,onlyVisible:true,trs:true}));
const loaded=await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.byteLength),'');
const meshes=[];loaded.scene.traverse(n=>{if(n.isMesh)meshes.push(n);});
if(meshes.length!==6||new Set(meshes.map(n=>n.name)).size!==6||loaded.animations.length)throw Error('Mesh identity or static-model round trip failed.');
const metrics={model:'f4412',sourceUnits:'inches',sourceBytes:glb.length,sha256:createHash('sha256').update(glb).digest('hex'),meshes:meshes.length,triangles:meshes.reduce((n,m)=>n+(m.geometry.index?.count||m.geometry.attributes.position.count)/3,0),catalogDimensions:{A:3.125,B:2.75,D:.75},inspectionRegions:Object.keys(groups),animations:0};
await writeFile(new URL('model.glb',here),glb);
await writeFile(new URL('import-definition.json',here),JSON.stringify(definition,null,2)+'\n');
await writeFile(new URL('authored-tour.json',here),JSON.stringify(tour,null,2)+'\n');
await writeFile(new URL('source-metrics.json',here),JSON.stringify(metrics,null,2)+'\n');
console.log(JSON.stringify(metrics,null,2));
