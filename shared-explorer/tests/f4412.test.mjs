import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {loadProject} from '../scripts/lib/project-config.mjs';
import {featurePolicy,tourRequirements} from '../src/explorer/project-features.js';
import {sampleTour} from '../src/explorer/tour-content.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Box3} from 'three';
import {F4412_MODEL_META} from '../../src/f4412-model-meta.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const project=await loadProject(root),model=project.models[0];

test('host capture metadata pins the exact served package and distinguishes illustration from catalog facts',()=>{
  assert.equal(F4412_MODEL_META.modelRevision,model.revision);
  assert.equal(F4412_MODEL_META.modelId,model.manifest.id);
  assert.equal(F4412_MODEL_META.illustrative,true);assert.equal(F4412_MODEL_META.manufacturerCAD,false);
  assert.equal(F4412_MODEL_META.verifiedBOM,false);assert.equal(F4412_MODEL_META.catalogSource.page,6);
});

test('F-4412 is the only package and permits inspection without invented operation or separation',()=>{
  assert.equal(project.models.length,1);assert.equal(model.manifest.id,'f4412');
  const policy=featurePolicy(project.project,model.runtime);
  assert.deepEqual(policy.modes,['explore']);assert.equal(policy.operation,false);
  assert.deepEqual(policy.tours,['f4412-inspection']);
  assert.equal(model.metadata.operation,undefined);
  assert.match(model.manifest.provenance.note,/Not manufacturer CAD/);
  assert.match(model.manifest.provenance.note,/not a verified BOM/);
});

test('the three inspection states have deterministic camera/highlight/selection and no motion claims',()=>{
  const tour=model.runtime.tour;
  assert.equal(tour.playback,'steps');assert.deepEqual(tour.chapters.map(c=>c.id),['belt','flange','mount']);
  assert.deepEqual(tourRequirements(tour),{renderStyles:['engineering'],explode:false,operation:false});
  for(const [index,chapter] of tour.chapters.entries()){
    for(const settled of [false,true]){
      const frame=sampleTour(tour,chapter.start,{settled,chapterIndex:index});
      assert.equal(frame.selectedId,chapter.id);assert.equal(frame.scopeId,'f4412');
      assert.deepEqual(frame.highlightIds,[chapter.id]);assert.equal(frame.explosion,0);
      assert.equal(frame.operationProgress,null);assert.ok(frame.camera.direction.every(Number.isFinite));
    }
  }
});

test('preserved GLB has no animations and catalog envelope dimensions A/B/D survive export',async()=>{
  const original=await readFile(new URL('../source/model.glb',import.meta.url));
  const bytes=await readFile(model.assets.model);assert.deepEqual(bytes,original);
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  assert.equal(gltf.animations.length,0);gltf.scene.updateMatrixWorld(true);
  const getBounds=name=>new Box3().setFromObject(gltf.scene.getObjectByName(name));
  const flange=getBounds('flange_front'),belt=getBounds('belt_surface');
  const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-5,`${actual} != ${expected}`);
  close(flange.max.x-flange.min.x,3.125);close(belt.max.x-belt.min.x,2.75);close(belt.max.z-belt.min.z,.75);
  const names=[];gltf.scene.traverse(node=>{if(node.isMesh)names.push(node.name);});
  assert.equal(names.length,6);assert.equal(new Set(names).size,6);
});
