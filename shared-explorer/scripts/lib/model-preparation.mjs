import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { AnimationMixer, Box3, EdgesGeometry, LoopOnce, Matrix4, PropertyBinding, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildContourSegments, packContourSegments, CONTOUR_RECORD_BYTES } from '../../src/explorer/assembly-linework-data.js';
import { FINISHES } from '../../src/explorer/appearance.js';

export const IMPORT_LIMITS=Object.freeze({sourceBytes:64*1024*1024,jsonBytes:2*1024*1024,meshes:2000,nodes:10000,triangles:1000000,trianglesPerGeometry:250000,vertices:3000000,animationKeys:100000,clipSeconds:120,outputBytes:192*1024*1024});
export const sha256=value=>createHash('sha256').update(value).digest('hex');
const check=(condition,message)=>{if(!condition)throw new Error(message);};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const string=value=>typeof value==='string'&&value.trim().length>0;
const boundedText=(value,max)=>string(value)&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const vector=(value,length=3)=>Array.isArray(value)&&value.length===length&&value.every(Number.isFinite);
const identifier=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value)&&!['__proto__','prototype','constructor'].includes(value);
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const gzip=bytes=>gzipSync(bytes,{level:9,mtime:0});
const bounds=object=>{const box=new Box3().setFromObject(object);return [box.min.toArray(),box.max.toArray()];};
function safeJSON(value,depth=0){
  if(depth>24)return false;
  if(value===null||typeof value==='string'||typeof value==='boolean')return true;
  if(typeof value==='number')return Number.isFinite(value);
  if(Array.isArray(value))return value.length<=10000&&value.every(item=>safeJSON(item,depth+1));
  return plain(value)&&Object.keys(value).length<=10000&&Object.entries(value).every(([key,item])=>!['__proto__','constructor','prototype'].includes(key)&&safeJSON(item,depth+1));
}
function assertKeys(value,keys,label){check(plain(value),`${label} must be an object.`);check(Object.keys(value).every(key=>keys.includes(key)),`${label} has an unknown field; check the definition schema.`);}

export function validateDefinition(definition){
  check(safeJSON(definition),'The definition must contain finite JSON data.');
  assertKeys(definition,['schemaVersion','id','rootId','title','shortTitle','provenance','licenseFile','licenseText','view','creaseAngle','groups','parts','operation','tour','presentationPolicy'],'Definition');
  check(definition.schemaVersion===1,'Definition schemaVersion must be 1.');
  check(typeof definition.id==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(definition.id)&&!['constructor','prototype','__proto__'].includes(definition.id),'Definition id must start with a lowercase letter and contain only lowercase letters, digits or hyphens (up to 64 characters); reserved names are not allowed.');
  check(identifier(definition.rootId??definition.id),'A valid rootId is required.');
  check(boundedText(definition.title,160),'A nonempty model title of at most 160 characters without control characters is required.');
  check(boundedText(definition.shortTitle===undefined?definition.title:definition.shortTitle,80),'shortTitle must be nonempty, at most 80 characters and contain no control characters. Provide shortTitle when title exceeds 80 characters.');
  assertKeys(definition.provenance,['author','url','license','attribution','description','note'],'provenance');
  for(const key of ['author','license','attribution','description','note'])check(string(definition.provenance[key]),`provenance.${key} is required. Use an explicit unknown value when evidence is unavailable.`);
  if(definition.provenance.url){let parsed;try{parsed=new URL(definition.provenance.url);}catch{}check(parsed&&['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password,'provenance.url must be an HTTP(S) URL without credentials.');}
  check(Number(string(definition.licenseText))+Number(string(definition.licenseFile))===1,'Provide exactly one licenseText or definition-relative licenseFile.');
  check(definition.tour===undefined||string(definition.tour),'tour must be a definition-relative JSON filename. No automatic tour is generated.');
  if(definition.view!==undefined){assertKeys(definition.view,['direction','normalizedWidth','labels','facts'],'view');if(definition.view.direction)check(vector(definition.view.direction)&&Math.hypot(...definition.view.direction)>0,'view.direction must be a nonzero finite vector.');if(definition.view.normalizedWidth!==undefined)check(Number.isFinite(definition.view.normalizedWidth)&&definition.view.normalizedWidth>0,'view.normalizedWidth must be positive.');if(definition.view.labels)check(Array.isArray(definition.view.labels)&&definition.view.labels.length===2&&definition.view.labels.every(string),'view.labels needs two nonempty labels.');}
  check(definition.creaseAngle===undefined||Number.isFinite(definition.creaseAngle)&&definition.creaseAngle>0&&definition.creaseAngle<180,'creaseAngle must be between 0 and 180 degrees.');
  if(definition.presentationPolicy!==undefined)check(plain(definition.presentationPolicy),'presentationPolicy must be JSON object data.');
  if(definition.parts!==undefined)check(plain(definition.parts),'parts must map exact loaded mesh names to part overrides.');
  if(definition.groups!==undefined)check(Array.isArray(definition.groups)&&definition.groups.length>0,'groups must be a nonempty array.');
  return definition;
}

/** Validate all GLB resource references before allowing GLTFLoader to parse it.
 * The deliberately narrow adapter never fetches a decoder, texture or external file.
 */
export function inspectGLB(bytes){
  check(Buffer.isBuffer(bytes)&&bytes.length>=28,'Source must be a complete binary glTF (.glb) file.');
  check(bytes.length<=IMPORT_LIMITS.sourceBytes,'Source exceeds the 64 MiB import limit. Simplify or split the assembly.');
  check(bytes.readUInt32LE(0)===0x46546c67&&bytes.readUInt32LE(4)===2,'Only binary glTF 2.0 is supported. Convert CAD to a prepared rigid GLB first.');
  check(bytes.readUInt32LE(8)===bytes.length,'GLB byte length does not match its header.');
  const chunks=[];for(let at=12;at<bytes.length;){check(at+8<=bytes.length,'Truncated GLB chunk header.');const length=bytes.readUInt32LE(at),type=bytes.readUInt32LE(at+4);check(length%4===0&&at+8+length<=bytes.length,'Invalid GLB chunk length.');chunks.push({type,bytes:bytes.subarray(at+8,at+8+length)});at+=8+length;}
  check(chunks.length===2&&chunks[0].type===0x4e4f534a&&chunks[1].type===0x004e4942,'Use one JSON chunk and one embedded BIN chunk. External and extra resource chunks are unsupported.');
  check(chunks[0].bytes.length<=IMPORT_LIMITS.jsonBytes,'GLB JSON exceeds the 2 MiB metadata limit.');
  let document;try{document=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(chunks[0].bytes));}catch{throw new Error('GLB JSON is invalid UTF-8 or malformed.');}
  check(safeJSON(document),'GLB metadata must contain bounded finite JSON data.');
  check(document.asset?.version==='2.0','Only glTF version 2.0 is supported.');
  check(Array.isArray(document.buffers)&&document.buffers.length===1&&!document.buffers[0].uri,'External or multiple buffers are unsupported; export one embedded GLB buffer.');
  const binary=chunks[1].bytes,bufferLength=document.buffers[0].byteLength;
  check(Number.isInteger(bufferLength)&&bufferLength>0&&bufferLength<=binary.length&&binary.length-bufferLength<=3,'Invalid embedded buffer length.');
  const extensions=new Set([...(document.extensionsUsed||[]),...(document.extensionsRequired||[])]);
  check(![...extensions].some(value=>/draco|meshopt|quantization/i.test(value)),'Compressed or quantized mesh data is unsupported. Export uncompressed Float32 geometry.');
  check([...extensions].every(value=>value==='KHR_materials_unlit'),'Unsupported glTF extension. Export a plain rigid GLB; only KHR_materials_unlit is accepted.');
  check(!document.skins?.length,'Skinned meshes are unsupported. Export rigid components with source transforms.');
  check(!document.images?.length&&!document.textures?.length,'Textures and images are unsupported by this importer. Export untextured geometry; curate engineering finishes in the definition.');
  check(!document.cameras?.length,'Embedded cameras are unsupported. Set view.direction in the definition instead.');
  check(Array.isArray(document.scenes)&&document.scenes.length===1&&(document.scene??0)===0,'Exactly one default scene is required.');
  const nodes=document.nodes;check(Array.isArray(nodes)&&nodes.length>0&&nodes.length<=IMPORT_LIMITS.nodes,'A model needs 1–10,000 source nodes.');
  check(Array.isArray(document.meshes)&&document.meshes.length>0,'No rigid meshes were found.');
  const parent=new Map(),visited=new Set(),visiting=new Set(),loadedNames=new Set();let meshInstances=0,totalTriangles=0,totalVertices=0;
  for(const [index,node]of nodes.entries()){
    check(plain(node)&&node.skin===undefined&&!node.weights,'Skinning and morph weights are unsupported.');check(!node.extensions,'Extended node transforms/instancing are unsupported.');check(node.children===undefined||Array.isArray(node.children),'Node children must be an array.');
    if(node.name){check(string(node.name),'Source node names must be nonempty strings.');const name=PropertyBinding.sanitizeNodeName(node.name);check(name&&!loadedNames.has(name)&&!['__proto__','prototype','constructor'].includes(name),`Node names must remain unique after glTF name normalization: ${node.name}`);loadedNames.add(name);}
    if(node.matrix){check(vector(node.matrix,16)&&node.translation===undefined&&node.rotation===undefined&&node.scale===undefined,`Node ${index} has an invalid matrix or mixed matrix/TRS transforms.`);assertRigidMatrix(new Matrix4().fromArray(node.matrix),`Node ${index}`);}
    if(node.translation)check(vector(node.translation),`Invalid translation on node ${index}.`);
    if(node.rotation)check(vector(node.rotation,4)&&Math.abs(Math.hypot(...node.rotation)-1)<1e-4,`Node ${index} rotation must be a normalized quaternion.`);
    if(node.scale)check(vector(node.scale)&&node.scale.every(value=>Math.abs(value)>1e-10),`Node ${index} has singular scale.`);
    for(const child of node.children||[]){check(Number.isInteger(child)&&child>=0&&child<nodes.length&&!parent.has(child),`Invalid or multiply-parented source node ${child}.`);parent.set(child,index);}
    if(node.mesh!==undefined){check(Number.isInteger(node.mesh)&&document.meshes[node.mesh],`Node ${index} has an invalid mesh reference.`);check(string(node.name),`Mesh node ${index} needs a unique name before import.`);meshInstances++;}
  }
  const visit=(index,depth=0)=>{check(depth<=128,'Source hierarchy exceeds the 128-level depth limit.');check(Number.isInteger(index)&&nodes[index],'Scene references an invalid node.');check(!visiting.has(index),'The source transform hierarchy contains a cycle.');check(!visited.has(index),'Scene roots overlap or repeat.');visiting.add(index);for(const child of nodes[index].children||[])visit(child,depth+1);visiting.delete(index);visited.add(index);};
  check(Array.isArray(document.scenes[0].nodes)&&document.scenes[0].nodes.length>0,'The scene must contain source roots.');
  for(const index of document.scenes[0].nodes){check(!parent.has(index),'A scene root also has a parent.');visit(index);}
  check(visited.size===nodes.length,'All source nodes must belong to the single scene; remove unreachable nodes.');
  check(meshInstances>0&&meshInstances<=IMPORT_LIMITS.meshes,'The model exceeds the 2,000 rigid mesh instance limit.');
  const types={5120:[1,'getInt8'],5121:[1,'getUint8'],5122:[2,'getInt16'],5123:[2,'getUint16'],5125:[4,'getUint32'],5126:[4,'getFloat32']},sizes={SCALAR:1,VEC2:2,VEC3:3,VEC4:4};
  const views=document.bufferViews||[],accessors=document.accessors||[];
  for(const view of views){check(view.buffer===0&&Number.isInteger(view.byteLength)&&view.byteLength>=0&&Number.isInteger(view.byteOffset??0)&&(view.byteOffset??0)>=0&&(view.byteOffset??0)+view.byteLength<=bufferLength,'A bufferView exceeds the embedded buffer.');check(view.byteStride===undefined||Number.isInteger(view.byteStride)&&view.byteStride>=4&&view.byteStride<=252&&view.byteStride%4===0,'Invalid attribute byte stride.');check(!view.extensions,'Compressed/extended buffer views are unsupported.');}
  const data=accessors.map((accessor,index)=>{
    check(!accessor.sparse,`Sparse accessor ${index} is unsupported. Export dense arrays.`);
    const type=types[accessor.componentType],width=sizes[accessor.type],view=views[accessor.bufferView];
    check(type&&width&&view&&Number.isInteger(accessor.count)&&accessor.count>=0,`Accessor ${index} has an unsupported type or missing bufferView.`);
    check(view.byteStride===undefined||view.byteStride===width*type[0],'Interleaved attributes are unsupported. Export tightly packed arrays.');
    const offset=accessor.byteOffset??0,length=accessor.count*width*type[0];
    check(Number.isSafeInteger(length)&&Number.isInteger(offset)&&offset>=0&&offset%type[0]===0&&offset+length<=view.byteLength,`Accessor ${index} exceeds its bufferView.`);
    check(accessor.count<=IMPORT_LIMITS.vertices,`Accessor ${index} exceeds the vertex/key limit.`);
    const buffer=new DataView(binary.buffer,binary.byteOffset+(view.byteOffset??0)+offset,length);
    const read=i=>buffer[type[1]](i*type[0],true);
    if(accessor.componentType===5126)for(let item=0;item<accessor.count*width;item++)check(Number.isFinite(read(item)),`Accessor ${index} contains a non-finite value.`);
    return {accessor,width,read};
  });
  const meshStats=document.meshes.map((mesh,index)=>{
    check(Array.isArray(mesh.primitives)&&mesh.primitives.length===1,`Mesh ${index} must have exactly one primitive/material. Split multi-material objects before import.`);
    check(!mesh.weights,'Morph targets are unsupported.');const primitive=mesh.primitives[0];
    check((primitive.mode??4)===4,'Only triangle meshes are supported.');check(!primitive.targets?.length,'Morph targets are unsupported.');check(!primitive.extensions,'Compressed/extended primitives are unsupported.');
    check(plain(primitive.attributes)&&Object.keys(primitive.attributes).every(key=>['POSITION','NORMAL','TEXCOORD_0','COLOR_0'].includes(key)),'Unsupported vertex attribute. Export plain rigid positions/normals.');
    const position=data[primitive.attributes.POSITION];check(position&&position.accessor.type==='VEC3'&&position.accessor.componentType===5126&&!position.accessor.normalized,`Mesh ${index} requires uncompressed Float32 VEC3 positions.`);
    for(const accessorId of Object.values(primitive.attributes))check(data[accessorId]&&data[accessorId].accessor.count===position.accessor.count,'Vertex attributes must match the position count.');
    check(vector(position.accessor.min)&&vector(position.accessor.max),'Position accessors need finite min/max bounds.');
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<position.accessor.count;i++)for(let axis=0;axis<3;axis++){const value=position.read(i*3+axis);min[axis]=Math.min(min[axis],value);max[axis]=Math.max(max[axis],value);}
    for(let axis=0;axis<3;axis++){const tolerance=Math.max(1,Math.abs(min[axis]),Math.abs(max[axis]))*1e-6;check(Math.abs(min[axis]-position.accessor.min[axis])<=tolerance&&Math.abs(max[axis]-position.accessor.max[axis])<=tolerance,'Declared position bounds differ from the actual geometry. Re-export valid bounds.');}
    let count=position.accessor.count;
    if(primitive.indices!==undefined){const indices=data[primitive.indices];check(indices&&indices.accessor.type==='SCALAR'&&[5121,5123,5125].includes(indices.accessor.componentType)&&!indices.accessor.normalized,'Triangle indices must be unsigned integers.');count=indices.accessor.count;for(let i=0;i<count;i++)check(indices.read(i)<position.accessor.count,'A triangle index exceeds its position array.');}
    check(count>0&&count%3===0,'Triangle index/vertex count must be positive and divisible by three.');check(count/3<=IMPORT_LIMITS.trianglesPerGeometry,'One geometry exceeds 250,000 triangles. Split or simplify it before import.');
    check(primitive.material===undefined||document.materials?.[primitive.material],'Invalid material reference.');
    return {triangles:count/3,vertices:position.accessor.count};
  });
  for(const node of nodes)if(node.mesh!==undefined){totalTriangles+=meshStats[node.mesh].triangles;totalVertices+=meshStats[node.mesh].vertices;}
  check(totalTriangles<=IMPORT_LIMITS.triangles&&totalVertices<=IMPORT_LIMITS.vertices,'Assembly exceeds 1,000,000 triangles or 3,000,000 referenced vertices. Split or simplify it.');
  let animationKeys=0;const clipNames=new Set();
  for(const animation of document.animations||[]){
    check(string(animation.name)&&!clipNames.has(animation.name),'Every animation clip needs a unique nonempty name.');clipNames.add(animation.name);
    check(animation.channels?.length>0,'An authored animation needs channels.');const channels=new Set();
    for(const channel of animation.channels){
      check(nodes[channel.target?.node]&&['translation','rotation'].includes(channel.target.path),'Only rigid translation and rotation animation channels are supported. Scale, weights and pointer animation are unsupported.');
      const key=`${channel.target.node}:${channel.target.path}`;check(!channels.has(key),'An animation repeats the same node/property channel.');channels.add(key);
      const sampler=animation.samplers?.[channel.sampler],input=data[sampler?.input],output=data[sampler?.output],interpolation=sampler?.interpolation||'LINEAR';
      check(input&&output&&input.accessor.type==='SCALAR'&&input.accessor.componentType===5126&&output.accessor.componentType===5126&&['LINEAR','STEP','CUBICSPLINE'].includes(interpolation),'An animation sampler uses unsupported accessors/interpolation.');
      check(input.accessor.count>=2&&output.width===(channel.target.path==='rotation'?4:3)&&output.accessor.count===input.accessor.count*(interpolation==='CUBICSPLINE'?3:1),'Animation input/output dimensions do not match.');
      let previous=-1;for(let i=0;i<input.accessor.count;i++){const time=input.read(i);check(time>=0&&time>previous&&time<=IMPORT_LIMITS.clipSeconds,'Animation times must increase within 0–120 seconds.');previous=time;}
      if(channel.target.path==='rotation')for(let key=0;key<input.accessor.count;key++){const offset=(key*(interpolation==='CUBICSPLINE'?3:1)+(interpolation==='CUBICSPLINE'?1:0))*4;check(Math.abs(Math.hypot(...[0,1,2,3].map(component=>output.read(offset+component)))-1)<1e-3,'Animation rotation keys must be normalized quaternions.');}
      animationKeys+=input.accessor.count;check(animationKeys<=IMPORT_LIMITS.animationKeys,'Animation exceeds the 100,000 keyframe limit.');
    }
  }
  return {document,binary,parent,meshInstances,totalTriangles,totalVertices,animationKeys};
}

function assertRigidMatrix(matrix,label){
  const values=matrix.elements;check(values.every(Number.isFinite)&&Number.isFinite(matrix.determinant())&&matrix.determinant()!==0,`${label} has a non-finite or singular transform.`);
  check(Math.abs(values[3])+Math.abs(values[7])+Math.abs(values[11])<1e-8&&Math.abs(values[15]-1)<1e-8,`${label} has a perspective transform.`);
  const axes=[0,4,8].map(index=>new Vector3(values[index],values[index+1],values[index+2]));
  check(axes.every(axis=>axis.length()>1e-12),`${label} has a singular transform scale.`);axes.forEach(axis=>axis.normalize());
  check(Math.abs(axes[0].dot(axes[1]))<1e-6&&Math.abs(axes[0].dot(axes[2]))<1e-6&&Math.abs(axes[1].dot(axes[2]))<1e-6,`${label} has shear. Bake shear into geometry while preserving rigid source pivots.`);
  const p=new Vector3(),q=new Quaternion(),s=new Vector3();matrix.decompose(p,q,s);const rebuilt=new Matrix4().compose(p,q,s).elements;
  check(values.every((value,i)=>Math.abs(value-rebuilt[i])<=1e-6*Math.max(1,Math.abs(value))),`${label} has shear. Bake shear into geometry while preserving rigid source pivots.`);
}

function assertManifold(geometry,name){
  const positions=geometry.getAttribute('position'),indices=geometry.index,box=new Box3().setFromBufferAttribute(positions),tolerance=Math.max(box.getSize(new Vector3()).length()*1e-7,1e-8);
  const points=new Map(),ids=new Uint32Array(positions.count);let next=0;
  for(let i=0;i<positions.count;i++){const key=[positions.getX(i),positions.getY(i),positions.getZ(i)].map(value=>Math.round(value/tolerance)).join(':');if(!points.has(key))points.set(key,next++);ids[i]=points.get(key);}
  const edges=new Map(),count=indices?.count??positions.count;
  for(let i=0;i<count;i+=3){const triangle=[0,1,2].map(offset=>ids[indices?indices.getX(i+offset):i+offset]);if(new Set(triangle).size<3)continue;
    for(let corner=0;corner<3;corner++){const a=triangle[corner],b=triangle[(corner+1)%3],key=a<b?`${a}:${b}`:`${b}:${a}`;const uses=(edges.get(key)||0)+1;check(uses<=2,`Mesh ${name} has non-manifold or overlapping triangle edges. Repair the mesh before line preparation.`);edges.set(key,uses);}
  }
}

function deriveGroups(gltf,inspection,parts,definition){
  if(definition.groups){check(Array.isArray(definition.groups)&&definition.groups.length>0,'groups must be a nonempty array.');return structuredClone(definition.groups);}
  const {document,parent}=inspection,roots=document.scenes[0].nodes,byBranch=new Map();
  for(const part of parts){let branch=part.sourceNodeIndex;while(parent.has(branch)&&!roots.includes(parent.get(branch)))branch=parent.get(branch);
    if(roots.length===1&&branch===roots[0])branch=roots[0];
    const key=branch;let group=byBranch.get(key);if(!group){group={id:`${definition.id}-group-${branch}`,title:document.nodes[branch].name||`Source group ${branch}`,description:'A navigation group derived from source-node containment, not a verified mechanical relationship.',meshNames:[]};byBranch.set(key,group);}group.meshNames.push(part.meshName);
  }
  return [...byBranch.values()];
}
function curateMetadata(gltf,inspection,definition){
  gltf.scene.updateMatrixWorld(true);const meshes=[];gltf.scene.traverse(mesh=>{if(mesh.isMesh){check(!mesh.isSkinnedMesh&&!Array.isArray(mesh.material)&&!mesh.geometry.morphAttributes.position?.length,'Only single-material rigid meshes are supported.');assertRigidMatrix(mesh.matrixWorld,`Mesh ${mesh.name}`);meshes.push(mesh);}});
  check(meshes.length===inspection.meshInstances,'Loaded mesh count differs from the source. Unsupported primitive conversion may have occurred.');
  const meshNames=new Set(meshes.map(mesh=>mesh.name));check(meshNames.size===meshes.length,'Loaded component names must be unique.');
  for(const name of Object.keys(definition.parts||{}))check(meshNames.has(name),`Part override references an unknown loaded mesh: ${name}`);
  const parts=meshes.map(mesh=>{
    const nodeIndex=gltf.parser.associations.get(mesh)?.nodes;check(Number.isInteger(nodeIndex),'A component lacks its source-node association.');
    const node=inspection.document.nodes[nodeIndex],b=bounds(mesh),override=definition.parts?.[mesh.name]||{};
    assertKeys(override,['id','title','description','explode','finishFamily'],`Part ${mesh.name}`);
    const path=[];for(let index=nodeIndex;index!==undefined;index=inspection.parent.get(index))path.unshift(inspection.document.nodes[index].name||`node-${index}`);
    return {id:override.id||`${definition.id}-part-${nodeIndex}`,meshName:mesh.name,sourceName:node.name,sourceNodeIndex:nodeIndex,sourcePath:'/'+path.join('/'),title:override.title||node.name,description:override.description||'An original rigid source component. Its engineering finish is illustrative.',center:b[0].map((value,i)=>(value+b[1][i])/2),bounds:b,triangles:(mesh.geometry.index?.count??mesh.geometry.getAttribute('position').count)/3,sourceMaterial:mesh.material?.name||'Unspecified',...override};
  });
  const groups=deriveGroups(gltf,inspection,parts,definition),ids=new Set([definition.rootId||definition.id]),assigned=new Set();
  const useID=id=>{check(identifier(id)&&!ids.has(id),`Duplicate or invalid navigation ID: ${id}`);ids.add(id);};
  for(const group of groups){
    assertKeys(group,['id','title','description','meshNames','explode','finishFamily','children'],`Group ${group.id}`);useID(group.id);check(string(group.title),'Each group requires a title.');check(Array.isArray(group.meshNames)&&group.meshNames.length>0,'Each group must contain source mesh names.');
    for(const name of group.meshNames){check(meshNames.has(name)&&!assigned.has(name),`Mesh ${name} is missing, duplicated or assigned to multiple groups.`);assigned.add(name);const part=parts.find(part=>part.meshName===name);part.group=group.id;part.finishFamily=part.finishFamily||group.finishFamily||'satin';if(!part.explode&&group.explode)part.explode=[...group.explode];}
    if(group.explode)check(vector(group.explode),'Group explosion offsets must be finite vectors.');
    if(group.finishFamily)check(Object.hasOwn(FINISHES,group.finishFamily),'Unknown group finishFamily.');
    const subgrouped=new Set();for(const child of group.children||[]){assertKeys(child,['id','title','description','meshNames'],`Subgroup ${child.id}`);useID(child.id);check(string(child.title)&&Array.isArray(child.meshNames)&&child.meshNames.length>0,'Subgroups need a title and meshNames.');for(const name of child.meshNames){check(group.meshNames.includes(name)&&!subgrouped.has(name),'Subgroup membership must be unique within its parent group.');subgrouped.add(name);}}
    group.children??=[];delete group.explode;delete group.finishFamily;
  }
  check(assigned.size===parts.length,'Every source mesh must belong to exactly one group.');
  for(const part of parts){useID(part.id);check(string(part.title)&&string(part.description),'Part titles and descriptions must be nonempty.');check(Object.hasOwn(FINISHES,part.finishFamily),'Unknown part finishFamily.');if(part.explode)check(vector(part.explode),'Part explosion offsets must be finite vectors.');part.finishBasis='Curated illustrative engineering finish; not a verified material specification.';}
  const assembled=bounds(gltf.scene);check(assembled.flat().every(Number.isFinite)&&assembled[1][0]-assembled[0][0]>1e-10,'The source needs finite, nonzero width for display normalization.');
  return {meshes,ids,metadata:{schemaVersion:1,root:{id:definition.rootId||definition.id,title:definition.title,description:definition.provenance.description},source:{...definition.provenance,file:'model.glb',preserved:['geometry','source hierarchy','materials','pivots','authored animation channels']},bounds:assembled,orientation:{up:'+Y',sourceUnits:'unverified',defaultDirection:definition.view?.direction||[.55,.8,1.35]},groups,parts}};
}

function prepareOperation(gltf,meshes,metadata,definition,ids){
  if(!definition.operation)return;
  const authored=definition.operation;assertKeys(authored,['clipName','duration','stages','cameraDirection'],'operation');
  check(string(authored.clipName),'operation.clipName must name a real source clip.');const clip=gltf.animations.find(clip=>clip.name===authored.clipName);
  check(clip&&clip.tracks.length>0&&Number.isFinite(clip.duration)&&clip.duration>0,'The requested operation clip does not exist or has no positive duration.');
  check(authored.duration===undefined||Math.abs(authored.duration-clip.duration)<1e-5,'operation.duration differs from the preserved source clip.');
  check(Array.isArray(authored.stages)&&authored.stages.length>0,'An operation requires curated stages explaining the source motion.');
  let previous=-1;for(const stage of authored.stages){assertKeys(stage,['at','title','description','nodeId','cameraDirection'],'operation stage');check(Number.isFinite(stage.at)&&stage.at>=0&&stage.at<1&&stage.at>previous&&string(stage.title),'Operation stages need increasing normalized at values and titles.');previous=stage.at;if(stage.nodeId)check(ids.has(stage.nodeId),'An operation stage references an unknown navigation node.');if(stage.cameraDirection)check(vector(stage.cameraDirection)&&Math.hypot(...stage.cameraDirection)>0,'Stage cameraDirection must be nonzero.');}
  if(authored.cameraDirection)check(vector(authored.cameraDirection)&&Math.hypot(...authored.cameraDirection)>0,'operation.cameraDirection must be nonzero.');
  metadata.operation={...structuredClone(authored),duration:clip.duration,kind:'authored-source-animation'};
  const samples=Math.min(961,Math.max(61,Math.ceil(clip.duration*60)+1)),mixer=new AnimationMixer(gltf.scene),all=new Box3(),perMesh=meshes.map(()=>new Box3());const action=mixer.clipAction(clip);action.setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play();
  for(let frame=0;frame<samples;frame++){mixer.setTime(clip.duration*frame/(samples-1));gltf.scene.updateMatrixWorld(true);meshes.forEach((mesh,index)=>{assertRigidMatrix(mesh.matrixWorld,`Animated mesh ${mesh.name}`);const box=new Box3().setFromObject(mesh);perMesh[index].union(box);all.union(box);});}
  metadata.parts.forEach((part,index)=>{part.cycleBounds=[perMesh[index].min.toArray(),perMesh[index].max.toArray()];});metadata.cycleBounds=[all.min.toArray(),all.max.toArray()];metadata.cycleBoundsSampling={coordinates:'source-world',samples,purpose:'Sampled framing envelope; not an exact collision or mechanical validation.'};
  mixer.stopAllAction();mixer.uncacheRoot(gltf.scene);gltf.scene.updateMatrixWorld(true);
}

function prepareLines(meshes,sourceHash,creaseAngle){
  const edgeChunks=[],contourChunks=[],edgeGeometries=[],contourGeometries=[],edgeMeshes={},contourMeshes={},cache=new Map();let edgeOffset=0,contourOffset=0;
  for(const mesh of meshes){
    const geometry=mesh.geometry,position=geometry.getAttribute('position'),index=geometry.index;
    check(!position.isInterleavedBufferAttribute,'Interleaved positions are unsupported.');
    const hash=createHash('sha256').update(`${position.count}:${index?.count||0}:${index?.array.BYTES_PER_ELEMENT||0}:`).update(Buffer.from(position.array.buffer,position.array.byteOffset,position.array.byteLength));
    if(index)hash.update(Buffer.from(index.array.buffer,index.array.byteOffset,index.array.byteLength));const geometryHash=hash.digest('hex');
    let pair=cache.get(geometryHash);
    if(!pair){
      assertManifold(geometry,mesh.name);const edge=new EdgesGeometry(geometry,creaseAngle),points=edge.getAttribute('position'),edgeBytes=Buffer.alloc(points.array.length*4);points.array.forEach((value,i)=>edgeBytes.writeFloatLE(value,i*4));
      const contours=Buffer.from(packContourSegments(geometry,buildContourSegments(geometry)));
      const edgeRecord={byteOffset:edgeOffset,vertexCount:points.count,segmentCount:points.count/2,geometryId:cache.size};
      const contourRecord={byteOffset:contourOffset,segmentCount:contours.length/CONTOUR_RECORD_BYTES,geometryId:cache.size};
      geometry.computeBoundingBox();edgeGeometries.push({...edgeRecord,sourceGeometrySha256:geometryHash,edgeSha256:sha256(edgeBytes),bounds:[geometry.boundingBox.min.toArray(),geometry.boundingBox.max.toArray()]});contourGeometries.push({...contourRecord,sourceGeometrySha256:geometryHash,sha256:sha256(contours)});
      edgeChunks.push(edgeBytes);contourChunks.push(contours);edgeOffset+=edgeBytes.length;contourOffset+=contours.length;edge.dispose();pair={edge:edgeRecord,contour:contourRecord};cache.set(geometryHash,pair);
      check(edgeOffset+contourOffset<=IMPORT_LIMITS.outputBytes,'Prepared line data exceeds the 192 MiB package budget.');
    }
    edgeMeshes[mesh.name]=pair.edge;contourMeshes[mesh.name]=pair.contour;
  }
  const edges=Buffer.concat(edgeChunks),silhouettes=Buffer.concat(contourChunks);
  return {edges,silhouettes,edgeMetadata:{schemaVersion:1,source:{file:'model.glb',sha256:sourceHash},edges:{file:'edges.bin',compressedFile:'edges.bin.gz',compression:'gzip',format:'float32-le',coordinates:'mesh-local',topology:'line-segments',creaseAngle,sha256:sha256(edges)},stats:{meshCount:meshes.length,uniqueGeometryCount:cache.size,bytes:edges.length,uniqueSegments:edges.length/24},geometries:edgeGeometries,meshes:edgeMeshes},silhouetteMetadata:{schemaVersion:1,source:{file:'model.glb',sha256:sourceHash},contours:{file:'silhouettes.bin',compressedFile:'silhouettes.bin.gz',format:'uint32-oct16-le',coordinates:'original-mesh-local',bytesPerSegment:16,sha256:sha256(silhouettes)},stats:{meshCount:meshes.length,uniqueGeometryCount:cache.size,bytes:silhouettes.length,uniqueSegments:silhouettes.length/16},geometries:contourGeometries,meshes:contourMeshes}};
}

export function prepareTour(input,ids,operation){
  check(safeJSON(input)&&plain(input)&&identifier(input.id)&&string(input.title)&&Array.isArray(input.chapters)&&input.chapters.length>0&&input.chapters.length<=50,'An authored tour needs id, title and 1–50 chapters.');
  const tour=structuredClone(input),chapterIds=new Set();let duration=0;
  check(tour.playback === undefined || ['continuous','steps'].includes(tour.playback), 'Tour playback must be continuous or steps.');
  const reference=id=>check(ids.has(id),`Tour references an unknown navigation node: ${id}`);
  const pose=(value,complete)=>{
    if(complete){for(const key of ['scopeId','selectedId','camera','renderStyle','highlightIds','annotations'])check(value[key]!==undefined,`A tour chapter needs ${key}.`);}
    for(const key of ['scopeId','selectedId'])if(value[key]!==undefined)reference(value[key]);
    if(value.highlightIds!==undefined){check(Array.isArray(value.highlightIds),'highlightIds must be an array.');value.highlightIds.forEach(reference);}
    if(value.camera){reference(value.camera.focusId);check(vector(value.camera.direction)&&Math.hypot(...value.camera.direction)>0,'Tour cameras need nonzero directions.');if(value.camera.scale!==undefined)check(Number.isFinite(value.camera.scale)&&value.camera.scale>=1,'Tour camera scale must be at least 1.');if(value.camera.explosion!==undefined)check(Number.isFinite(value.camera.explosion)&&value.camera.explosion>=0&&value.camera.explosion<=1,'Tour camera explosion must be normalized.');}
    if(value.renderStyle!==undefined)check(['engineering','linework','flat'].includes(value.renderStyle),'Unknown tour render style.');
    if(value.annotations!==undefined){check(Array.isArray(value.annotations)&&value.annotations.length<=8,'Use at most eight tour annotations.');for(const annotation of value.annotations){reference(annotation.nodeId);check(string(annotation.label),'Tour annotations need labels.');}}
  };
  for(const chapter of tour.chapters){
    check(identifier(chapter.id)&&!chapterIds.has(chapter.id)&&string(chapter.label)&&string(chapter.title)&&Number.isFinite(chapter.duration)&&chapter.duration>0,'Tour chapter IDs must be unique and have labels, titles and positive duration.');chapterIds.add(chapter.id);pose(chapter,true);
    check(vector(chapter.explosion,2)&&chapter.explosion.every(value=>value>=0&&value<=1),'Tour explosion needs two normalized values.');
    for(const key of ['previewAt','settledAt','transitionStart'])if(chapter[key]!==undefined)check(Number.isFinite(chapter[key])&&chapter[key]>=0&&chapter[key]<=chapter.duration,`Tour ${key} lies outside its chapter.`);
    if(chapter.transition!==undefined)check(Number.isFinite(chapter.transition)&&chapter.transition>0,'Tour transition must be positive.');
    chapter.caption??='';check(typeof chapter.caption==='string','Tour caption must be text.');chapter.cues??=[];let previous=-1;const cueIds=new Set();
    for(const cue of chapter.cues){check(identifier(cue.id)&&!cueIds.has(cue.id)&&Number.isFinite(cue.at)&&cue.at>=0&&cue.at>previous&&cue.at<=chapter.duration,'Tour cues need unique IDs and increasing chapter-relative times.');cueIds.add(cue.id);previous=cue.at;pose(cue,false);}
    if(chapter.operation){const motion=chapter.operation;check(operation&&motion.clipName===operation.clipName&&Math.abs(motion.sourceDuration-operation.duration)<1e-5,'Tour motion must reference the declared source operation clip and duration.');check(Number.isFinite(motion.settledProgress)&&motion.settledProgress>=0&&motion.settledProgress<=1,'Tour settledProgress must be normalized.');check(Array.isArray(motion.passes)&&motion.passes.length>0,'Tour motion needs authored passes.');let end=-1;for(const pass of motion.passes){check(identifier(pass.id)&&Number.isFinite(pass.start)&&pass.start>=0&&pass.start>=end&&Number.isFinite(pass.duration)&&pass.duration>0&&pass.start+pass.duration<=chapter.duration,'Tour operating passes must be ordered, non-overlapping and within the chapter.');end=pass.start+pass.duration;check(Array.isArray(pass.keyframes)&&pass.keyframes.length>=2&&pass.keyframes[0].at===0&&pass.keyframes.at(-1).at===pass.duration,'Motion passes need keyframes covering the full pass.');let last=-1;for(const key of pass.keyframes){check(Number.isFinite(key.at)&&key.at>last&&Number.isFinite(key.progress)&&key.progress>=0&&key.progress<=1,'Motion keyframes need increasing times and normalized progress.');last=key.at;}}}
    chapter.start=duration;duration+=chapter.duration;chapter.end=duration;
  }
  check(duration<=300,'Tour exceeds the five-minute authoring limit.');check(tour.duration===undefined||Math.abs(tour.duration-duration)<1e-6,'Tour duration must equal the sum of its chapters.');tour.duration=duration;return tour;
}

export async function prepareModelPackage({sourceBytes,definition,licenseText,tour}){
  validateDefinition(definition);check(string(licenseText)&&Buffer.byteLength(licenseText)<=1024*1024,'License notice must be nonempty UTF-8 text up to 1 MiB.');
  const inspection=inspectGLB(sourceBytes),gltf=await new GLTFLoader().parseAsync(sourceBytes.buffer.slice(sourceBytes.byteOffset,sourceBytes.byteOffset+sourceBytes.byteLength),'');
  const {meshes,ids,metadata}=curateMetadata(gltf,inspection,definition),sourceHash=sha256(sourceBytes);
  prepareOperation(gltf,meshes,metadata,definition,ids);
  const prepared=prepareLines(meshes,sourceHash,definition.creaseAngle??35),compressed=gzip(sourceBytes);
  metadata.source.sha256=sourceHash;metadata.stats={meshCount:meshes.length,nodeCount:inspection.document.nodes.length,triangles:inspection.totalTriangles,vertices:inspection.totalVertices,animationClips:gltf.animations.length,bytes:sourceBytes.length,gzipBytes:compressed.length};
  const manifest={schemaVersion:1,id:definition.id,rootId:metadata.root.id,title:definition.title,shortTitle:definition.shortTitle||definition.title,assets:{model:'model.glb',compressedModel:'model.glb.gz',metadata:'metadata.json',edges:'edges.bin',compressedEdges:'edges.bin.gz',edgeMetadata:'edge-metadata.json',silhouettes:'silhouettes.bin',compressedSilhouettes:'silhouettes.bin.gz',silhouetteMetadata:'silhouette-metadata.json',license:'LICENSE.txt'},view:{direction:definition.view?.direction||[.55,.8,1.35],normalizedWidth:definition.view?.normalizedWidth||4.4,labels:definition.view?.labels||['Overview','Reverse'],...(definition.view?.facts?{facts:definition.view.facts}:{})},provenance:definition.provenance,...(definition.presentationPolicy?{presentationPolicy:definition.presentationPolicy}:{})};
  const files=new Map([['model.glb',sourceBytes],['model.glb.gz',compressed],['metadata.json',json(metadata)],['edges.bin',prepared.edges],['edges.bin.gz',gzip(prepared.edges)],['edge-metadata.json',json(prepared.edgeMetadata)],['silhouettes.bin',prepared.silhouettes],['silhouettes.bin.gz',gzip(prepared.silhouettes)],['silhouette-metadata.json',json(prepared.silhouetteMetadata)],['LICENSE.txt',Buffer.from(licenseText)]]);
  if(definition.tour){check(tour,'An authored tour JSON was requested but not supplied.');files.set('tour.json',json(prepareTour(tour,ids,metadata.operation)));manifest.tour='tour.json';}
  else check(!tour,'Tour input requires an explicit definition.tour filename.');
  files.set('manifest.json',json(manifest));
  const outputBytes=[...files.values()].reduce((sum,bytes)=>sum+bytes.length,0);check(outputBytes<=IMPORT_LIMITS.outputBytes,'Prepared package exceeds the 192 MiB output limit.');
  const warnings=[];if(inspection.totalTriangles>200000)warnings.push('Above 200,000 triangles: qualify ordinary computers and physical phones before release.');if(compressed.length>5*1024*1024)warnings.push('Compressed model exceeds 5 MiB: review cold-network loading.');if(!definition.groups)warnings.push('Navigation groups derive from source containment; review their labels and meaning.');if(!definition.operation&&gltf.animations.length)warnings.push('Source clips are preserved but not exposed. Add a curated operation definition to enable motion.');if(!definition.tour)warnings.push('No guided tour was authored; none was generated.');
  const report={schemaVersion:1,modelId:definition.id,sourceSha256:sourceHash,preservedSource:true,limits:IMPORT_LIMITS,counts:{meshes:meshes.length,nodes:inspection.document.nodes.length,triangles:inspection.totalTriangles,vertices:inspection.totalVertices,uniqueGeometries:prepared.edgeMetadata.stats.uniqueGeometryCount,sourceAnimationClips:gltf.animations.length},bytes:{source:sourceBytes.length,compressedModel:compressed.length,creases:prepared.edges.length,contours:prepared.silhouettes.length,total:outputBytes},operation:metadata.operation?.clipName||null,tour:manifest.tour||null,warnings,assets:Object.fromEntries([...files].map(([name,bytes])=>[name,{bytes:bytes.length,sha256:sha256(bytes)}]))};
  files.set('preparation-report.json',json(report));
  for(const mesh of meshes){mesh.geometry.dispose();mesh.material?.dispose();}
  return {manifest,metadata,report,files};
}
