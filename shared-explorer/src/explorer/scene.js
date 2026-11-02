import * as THREE from 'three';
import { DISPLAY_DEFAULTS, displayOptions } from './display-profiles.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createEngineeringEnvironment, createEngineeringLights, createEngineeringMaterial } from './engineering.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';
import { childForMesh, createOffsets, positionAt, ancestors } from './model-state.js';
import { viewingRegion } from './viewing-region.js';
import { loadBinary } from './asset-load.js';
import { abortable, throwIfAborted } from './network-load.js';
import { DampedMotion, nearestAngle, fitProjectedPoints } from './motion.js';
import { materialSpec, technicalSpec, FINISHES } from './appearance.js';
import { OperationPlayer, SourceAnimationPose } from './operation-player.js';
import { SeparationPlayer } from './separation-player.js';
import { BenchmarkRecorder, QUALITY_PROFILES, AdaptiveBudget, renderPixelRatio } from './performance.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const RENDER_STYLES=new Set(['engineering','linework','flat']);
const presentationStyle=state=>RENDER_STYLES.has(state.renderStyle)?state.renderStyle:state.technical?'linework':'engineering';
const effectiveFov=camera=>camera.zoom!==1&&camera.getEffectiveFOV?camera.getEffectiveFOV():camera.fov;

/** Source and display meshes share geometries; release each owned resource once. */
function disposeObjectResources(roots, extraGeometries = []) {
  const geometries=new Set(extraGeometries),materials=new Set(),textures=new Set(),images=new Set();
  for(const root of roots)root?.traverse(object=>{
    if(object.geometry)geometries.add(object.geometry);
    if(object.material)for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);
  });
  for(const material of materials)for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
  for(const geometry of geometries)geometry.dispose();
  for(const material of materials)material.dispose();
  for(const texture of textures){texture.dispose();for(const image of Array.isArray(texture.source?.data)?texture.source.data:[texture.source?.data])if(image?.close)images.add(image);}
  for(const image of images)image.close();
}

export class AssemblyScene {
  constructor(mount, metadata, hierarchy, callbacks, model = {}) {
    this.mount = mount; this.metadata = metadata; this.nodes = hierarchy.nodes; this.callbacks = callbacks;
    this.model=model;this.rootId=model.rootId||hierarchy.root.id;
    if(!this.rootId)throw new Error('The model package must identify its root assembly.');
    this.defaultDirection=new THREE.Vector3(...(model.defaultDirection||[.34,.2,1])).normalize();
    this.abort=new AbortController();this.mode='explore';this.selectedId=this.rootId;this.isolated=false;this.contextMeshes=[];this.followCamera=false;this.operationPlayer=new OperationPlayer();
    this.scopeId = this.rootId; this.fraction = 0; this.explosionTarget = 0; this.meshes = new Map(); this.edges = new Map(); this.active = []; this.dirty=true;
    this.renderStyle='engineering';this.technical=false;this.displayOptions={...DISPLAY_DEFAULTS};this.lineAccent=callbacks.theme?.outline||'#ff6840';
    this.raf=null;this.quality='balanced';this.effectiveQuality='balanced';this.loadMetrics={};this.benchmark=new BenchmarkRecorder();this.adaptive=new AdaptiveBudget();this.movingMeshes=new Set();
    this.scopeViews = new Map(); this.separationMotion = new DampedMotion([0], .16);
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#414141');
    this.camera = new THREE.PerspectiveCamera(15, 1, .05, 150);
    this.camera.position.copy(this.defaultDirection).multiplyScalar(14);
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'default' });
    this.renderer.info.autoReset=false;
    this.renderer.toneMapping = THREE.NeutralToneMapping; this.renderer.toneMappingExposure = 1;
    this.mount.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = .09; this.controls.rotateSpeed = .65;
    this.controls.minDistance = .3; this.controls.maxDistance = 70; this.controls.enablePan = true;
    this.controls.addEventListener('start', () => { this.callbacks.interact?.('camera');this.cancelBenchmark('user-input');this.cameraMotion?.stop(); this.controls.enableDamping = true; this.followCamera=false;this.emitOperation(true);this.hideHover(); });
    this.controls.addEventListener('change', () => { this.invalidate(); });
    this.environmentTarget = createEngineeringEnvironment(this.renderer);
    this.scene.environment = this.environmentTarget.texture; this.scene.environmentIntensity = 1;
    this.scene.add(createEngineeringLights());
    this.composer = new EffectComposer(this.renderer);
    this.surfacePass=new RenderPass(this.scene,this.camera);this.composer.addPass(this.surfacePass);
    this.ao = new SSAOPass(this.scene, this.camera, 1, 1, 8); this.ao.kernelRadius = 5; this.ao.minDistance = .001; this.ao.maxDistance = .012;
    this.composer.addPass(this.ao);this.outputPass=new OutputPass();this.composer.addPass(this.outputPass);
    this.outline = new OutlinePass(new THREE.Vector2(1,1), this.scene, this.camera);
    this.outline.visibleEdgeColor.setHex(parseInt(this.lineAccent.slice(1),16),THREE.LinearSRGBColorSpace); this.outline.hiddenEdgeColor.set(0x000000);
    this.outline.edgeStrength = 3.5; this.outline.edgeThickness = 1; this.outline.edgeGlow = 0; this.outline.downSampleRatio = 1;
    this.composer.addPass(this.outline);
    this.fxaa = new ShaderPass(FXAAShader); this.composer.addPass(this.fxaa);
    this.copyPass=new ShaderPass(CopyShader);this.copyPass.enabled=false;this.composer.addPass(this.copyPass);
    this.raycaster = new THREE.Raycaster(); this.pointer = new THREE.Vector2();
    const axisElements = callbacks.axisElements ?? [...document.querySelectorAll('.axis-marker i')].map((line,index)=>({line,label:document.querySelectorAll('.axis-marker b')[index]}));
    this.axisElements = axisElements.map(({line,label},index)=>({line,label,vector:new THREE.Vector3(index===0?1:0,index===1?1:0,index===2?1:0)}));
    this.addPicking();
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(mount);
    this.frame = this.frame.bind(this);
    document.addEventListener('visibilitychange',()=>{this.operationPlayer.setVisibility(document.hidden);if(document.hidden)this.separationAction?.pause();this.lastFrame=null;this.emitOperation(true);if(!document.hidden)this.invalidate();},{signal:this.abort.signal});
    this.resize();this.invalidate();
  }

  invalidate(){if(this.disposed)return;this.dirty=true;if(this.raf===null)this.raf=requestAnimationFrame(this.frame);}

  /** Completion evidence comes from the existing render loop, never a polling RAF. */
  async whenSettled({signal,settle=true,frame=true,ignorePlayback=false}={}) {
    if(this.disposed)return Promise.reject(new DOMException('Explorer disposed.','AbortError'));
    throwIfAborted(signal);
    return new Promise((resolve,reject)=>{
      const waiters=this.settleWaiters??=new Set();
      const waiter={settle,ignorePlayback,renderCount:(this.renderCount||0)+(frame?1:0),finish:error=>{waiters.delete(waiter);signal?.removeEventListener('abort',cancel);error?reject(error):resolve();}};
      const cancel=()=>waiter.finish(signal.reason||new DOMException('The operation was aborted.','AbortError'));
      waiters.add(waiter);signal?.addEventListener('abort',cancel,{once:true});
      this.flushSettledWaiters();if(waiters.has(waiter))this.invalidate();
    });
  }

  isSettled({ignorePlayback=false}={}) {
    return !this.disposed&&!this.cameraMotion?.active&&!this.separationMotion?.active&&!this.transformTransition&&!this.separationAction?.playing&&(ignorePlayback||!this.operationPlayer?.playing)&&!this.benchmark?.active&&!this.controlsMoving&&![...this.meshes.values()].some(mesh=>mesh.userData.pose?.active||mesh.userData.visibility?.active);
  }

  flushSettledWaiters() {
    for(const waiter of this.settleWaiters||[])if((this.renderCount||0)>=waiter.renderCount&&(!waiter.settle||this.isSettled({ignorePlayback:waiter.ignorePlayback})))waiter.finish();
  }

  cancelPresentationRequest({render=true,motion=true}={}) {
    this.presentationRequest=(this.presentationRequest||0)+1;
    if(render)this.modeRequest=(this.modeRequest||0)+1;
    if(motion&&!this.disposed)this.pausePresentation();
  }

  captureCameraView() {
    const layout=this.layoutRegion();
    return {position:this.camera.position.toArray(),target:this.controls.target.toArray(),up:this.camera.up.toArray(),projection:{kind:'perspective',verticalFovDegrees:this.camera.fov,zoom:this.camera.zoom,offsetX:this.offsetX||0,offsetY:this.offsetY||0},viewport:{width:layout.width,height:layout.height},layoutKey:layout.key};
  }

  restoreCameraView(view,{animate=true,refit=false}={}) {
    if(this.disposed||!view)return false;
    const triple=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
    if(!triple(view.position)||!triple(view.target)||!triple(view.up)||view.up.every(value=>value===0))return false;
    const projection=view.projection;
    if(projection?.kind!=='perspective'||!(projection.verticalFovDegrees>0&&projection.verticalFovDegrees<180)||!(projection.zoom>0)||![projection.zoom,projection.offsetX,projection.offsetY].every(Number.isFinite))return false;
    const center=new THREE.Vector3().fromArray(view.target),offset=new THREE.Vector3().fromArray(view.position).sub(center);
    if(offset.lengthSq()<.0001)return false;
    this.camera.up.fromArray(view.up);this.camera.fov=projection.verticalFovDegrees;this.camera.zoom=projection.zoom;this.camera.updateProjectionMatrix();
    const layout=this.layoutRegion(),direction=offset.clone().normalize();
    if(!refit&&view.layoutKey===layout.key){this.moveCamera(center,direction,offset.length(),{offsetX:projection.offsetX,offsetY:projection.offsetY},animate);this.lastLayoutKey=layout.key;}
    else this.fitMeshes(this.active,animate,direction);
    this.invalidate();return true;
  }

  async load(url, onProgress) {
    const started=performance.now();
    const modelUrl=url||this.model.modelUrl;
    if(!modelUrl)throw new Error('The model package has no source model asset.');
    const buffer=await loadBinary(modelUrl,this.model.compressedUrl,onProgress,{signal:this.abort.signal});
    throwIfAborted(this.abort.signal);if(this.disposed)return;
    this.loadMetrics.modelFetchMs=performance.now()-started;const parseStarted=performance.now();
    const gltf=await new GLTFLoader().parseAsync(buffer,'');
    if(this.disposed){disposeObjectResources([gltf.scene]);return;}
    throwIfAborted(this.abort.signal);this.loadMetrics.modelParseMs=performance.now()-parseStarted;
    this.sourceRoot=gltf.scene;gltf.scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(gltf.scene);
    this.scale = (this.model.normalizeWidth||4.4) / bounds.getSize(new THREE.Vector3()).x;
    const center = bounds.getCenter(new THREE.Vector3());
    const normalize = new THREE.Matrix4().makeScale(this.scale, this.scale, this.scale).multiply(new THREE.Matrix4().makeTranslation(-center.x,-center.y,-center.z));
    this.normalization=normalize;
    const records = new Map(this.metadata.parts.map(p => [p.meshName, p]));
    gltf.scene.traverse(source => {
      if (!source.isMesh || !records.has(source.name)) return;
      const record = records.get(source.name);
      const matrix = normalize.clone().multiply(source.matrixWorld);
      const original = Array.isArray(source.material) ? source.material[0] : source.material;
      const sourceSpec=materialSpec({...record,sourceMaterial:record.sourceMaterial||original.name},this.model.presentationPolicy);
      const hint=record.finishFamily||record.presentationFinish;const spec=Object.hasOwn(FINISHES,hint)?{...sourceSpec,...FINISHES[hint],basis:'Curated model finish hint'}:sourceSpec;
      const material=createEngineeringMaterial(spec);
      const mesh = new THREE.Mesh(source.geometry, material); mesh.name = source.name;
      matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.userData.source=source;mesh.userData.baseQuaternion=mesh.quaternion.clone();mesh.userData.baseScale=mesh.scale.clone();mesh.userData.spec=spec;mesh.userData.record = record; mesh.userData.base = mesh.position.toArray(); mesh.userData.color = material.color.clone(); mesh.userData.metalness = material.metalness; mesh.userData.roughness = material.roughness;
      mesh.userData.pose = new DampedMotion(mesh.position.toArray(), .16);
      mesh.userData.visibility = new DampedMotion([1], .065, .002);
      mesh.userData.baseOpacity = material.opacity; mesh.userData.baseTransparent = material.transparent; mesh.userData.baseDepthWrite = material.depthWrite;
      source.geometry.computeBoundingBox(); const box = source.geometry.boundingBox;
      mesh.userData.fitCorners = [];
      for (const x of [box.min.x,box.max.x]) for (const y of [box.min.y,box.max.y]) for (const z of [box.min.z,box.max.z]) {
        mesh.userData.fitCorners.push(new THREE.Vector3(x,y,z).multiply(mesh.scale).applyQuaternion(mesh.quaternion));
      }
      this.scene.add(mesh); this.meshes.set(mesh.name, mesh);
    });
    if (this.meshes.size !== records.size) throw new Error(`Incomplete model: ${this.meshes.size} / ${records.size} components.`);
    const operation=this.model.operation||this.metadata.operation;const clip=operation&&(operation.clipName?gltf.animations.find(item=>item.name===operation.clipName):gltf.animations[0]);
    if(operation&&!clip)throw new Error(`Missing authored animation clip: ${operation.clipName||'first clip'}.`);
    if(clip){this.operationConfig=operation;this.operationSampler=new SourceAnimationPose(gltf.scene,clip,normalize);this.operationPlayer=new OperationPlayer({duration:this.model.presentationPolicy?.actionDuration||operation.duration||clip.duration,stages:operation.stages||[]});}
    this.modelBounds = this.boxFor([...this.meshes.values()]);
    this.addGrid(); this.active = [...this.meshes.values()];
    this.offsets = createOffsets(this.metadata.parts, this.nodes, this.rootId, this.scale, this.model.presentationPolicy);
    this.outline.selectedObjects = [];
    this.ready = true; this.resize(); this.fit(false,this.defaultDirection);this.emitOperation(true); this.invalidate();
    await this.whenSettled({signal:this.abort.signal,settle:false});
    throwIfAborted(this.abort.signal);
    this.loadMetrics.firstInteractiveMs=performance.now()-started;

  }

  addGrid() {
    const geometry = new THREE.BufferGeometry(); const positions = []; const colors = [];
    const half = 10; const step = .5; const bottom = this.modelBounds.min.y - .12;
    for (let i = -half; i <= half; i += step) {
      const c = new THREE.Color(i % 2 === 0 ? '#6c7074' : '#484c50');
      for (const p of [[-half,bottom,i],[half,bottom,i],[i,bottom,-half],[i,bottom,half]]) { positions.push(...p); colors.push(c.r,c.g,c.b); }
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions,3)); geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    this.grid = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .18, depthWrite: false })); this.scene.add(this.grid);this.grid.visible=Boolean(this.displayOptions.grid);
  }

  boxFor(meshes) {
    const box = new THREE.Box3();
    meshes.forEach(mesh => { mesh.updateMatrixWorld(true); box.expandByObject(mesh); });
    return box;
  }

  currentDirection(destination = false) {
    if (destination && this.cameraMotion?.active) {
      const values = this.cameraMotion.target;
      return new THREE.Vector3().setFromSphericalCoords(1, values[4], values[3]);
    }
    const view = this.camera.position.clone().sub(this.controls.target);
    return view.lengthSq() > .0001 ? view.normalize() : this.defaultDirection.clone();
  }

  layoutRegion() {
    const width = this.mount.clientWidth, height = this.mount.clientHeight;
    const insets = this.callbacks.insets?.() || {};
    return { width, height, region: viewingRegion(width,height,insets), key: JSON.stringify([width,height,insets]) };
  }

  fit(animate = true, viewDirection = this.currentDirection(true)) {
    if (!this.active.length) return;
    this.cancelBenchmark('settings-changed');
    this.fitMeshes(this.active,animate,viewDirection,this.separationAction?.playing ? this.restTargets(Math.max(this.separationAction.from,this.separationAction.to)) : null);
  }

  fitMeshes(meshes, animate = true, viewDirection = this.currentDirection(true), poses = null) {
    if (!meshes.length) return;
    const layout = this.layoutRegion(); this.lastLayoutKey = layout.key;
    const points = [];
    meshes.forEach(mesh => {
      const target=poses?.get(mesh.name)||this.transformTransition?.targets.get(mesh.name);
      const envelope=this.mode==='operate'&&this.operationPlayer.playing&&mesh.userData.record?.cycleBounds;
      if(envelope&&this.normalization){
        // A following camera must leave room for the complete authored stroke.
        // The envelope is derived offline, so playback never resamples the clip to fit.
        for(const x of [envelope[0][0],envelope[1][0]])for(const y of [envelope[0][1],envelope[1][1]])for(const z of [envelope[0][2],envelope[1][2]])points.push(new THREE.Vector3(x,y,z).applyMatrix4(this.normalization));
      }else if(target||this.mode==='operate'){
        const pose=target||mesh,box=mesh.geometry.boundingBox;
        for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])points.push(new THREE.Vector3(x,y,z).multiply(pose.scale).applyQuaternion(pose.quaternion).add(pose.position));
      }else{
        const position = new THREE.Vector3().fromArray(mesh.userData.pose.target);
        mesh.userData.fitCorners.forEach(corner => points.push(corner.clone().add(position)));
      }
    });
    const dir = viewDirection.clone().normalize();
    // Overlay observers can refit before the renderer's resize observer runs.
    // Use this layout's aspect so the cached fit never uses the previous viewport.
    const {center,distance} = fitProjectedPoints(points,dir,effectiveFov(this.camera),layout.width/layout.height,layout.region,layout);
    this.moveCamera(center,dir,distance,layout.region,animate);
  }

  focusSelected() {
    const node=this.nodes.get(this.selectedId);if(!node)return;
    this.cancelBenchmark('user-input');this.setFollowCamera(false);
    const active=new Set(this.active),meshes=node.meshNames.map(name=>this.meshes.get(name)).filter(mesh=>active.has(mesh));
    this.fitMeshes(meshes);this.invalidate();
  }

  moveCamera(center, view, radius, region, animate, smoothTime = .13) {
    if (!this.cameraMotion?.active) {
      // Flush residual orbit damping before taking ownership of the camera.
      const displayedPosition = this.camera.position.clone(), displayedTarget = this.controls.target.clone();
      this.controls.enableDamping = false; this.controls.update();
      this.camera.position.copy(displayedPosition); this.controls.target.copy(displayedTarget); this.controls.update();
      const offset = this.camera.position.clone().sub(this.controls.target);
      const current = new THREE.Spherical().setFromVector3(offset.lengthSq() > .0001 ? offset : this.defaultDirection.clone().multiplyScalar(radius));
      this.cameraMotion = new DampedMotion([
        ...this.controls.target.toArray(), current.theta, current.phi,
        Math.log(Math.max(.3,current.radius)), this.offsetX || 0, this.offsetY || 0
      ], smoothTime);
    }
    this.cameraMotion.smoothTime=smoothTime;
    const theta = nearestAngle(Math.atan2(view.x,view.z),this.cameraMotion.values[3]);
    const phi = Math.max(.02,Math.min(Math.PI-.02,Math.acos(THREE.MathUtils.clamp(view.y,-1,1))));
    this.cameraMotion.to([...center.toArray(),theta,phi,Math.log(radius),region.offsetX,region.offsetY],!animate || reducedMotion.matches);
    this.applyCamera(); this.invalidate();
  }

  applyCamera() {
    const values = this.cameraMotion.values;
    this.controls.target.set(values[0],values[1],values[2]);
    this.camera.position.setFromSphericalCoords(Math.exp(values[5]),values[4],values[3]).add(this.controls.target);
    this.controls.enableDamping = false; this.controls.update();
    this.applyProjectionOffset(values[6],values[7]);
  }

  refitLayout(animate = true) {
    if (!this.ready || this.layoutRegion().key === this.lastLayoutKey) return;
    if(this.tourFrame){this.tourCameraKey=null;this.fitTourCamera(this.tourFrame,animate);}
    else this.fit(animate,this.currentDirection(true));
  }

  applyProjectionOffset(x,y) {
    this.offsetX=x;this.offsetY=y;
    const width=this.mount.clientWidth,height=this.mount.clientHeight;
    this.camera.setViewOffset(width,height,x,y,width,height);
    this.ao.ssaoMaterial.uniforms.cameraProjectionMatrix.value.copy(this.camera.projectionMatrix);
    this.ao.ssaoMaterial.uniforms.cameraInverseProjectionMatrix.value.copy(this.camera.projectionMatrixInverse);
    this.invalidate();
  }

  setTheme(roles) {
    this.cancelBenchmark('settings-changed');
    this.outline.visibleEdgeColor.setHex(parseInt(roles.outline.slice(1),16),THREE.LinearSRGBColorSpace);this.outline.hiddenEdgeColor.set(0x000000);
    this.mount.dataset.outline=roles.outline;
    this.lineAccent=roles.outline;this.outlineKey=null;this.refreshOutline();
    this.invalidate();
  }

  refreshOutline(stage = this.operationPlayer.state().stage) {
    if(this.benchmark.active)return;
    if(this.tourFrame){
      const ids=this.tourFrame.highlightIds||[],key=`tour:${this.scopeId}:${ids.join(',')}`;
      if(this.outlineKey===key)return;this.outlineKey=key;
      for(const mesh of this.hoverPreview||[])mesh.material.emissive.set(0x000000);this.hoverPreview=[];
      this.outline.visibleEdgeColor.setHex(parseInt((this.lineAccent||this.callbacks.theme?.outline||'#ff6840').slice(1),16),THREE.LinearSRGBColorSpace);
      const active=new Set(this.active),highlighted=new Set();
      for(const id of ids)for(const name of this.nodes.get(id)?.meshNames||[]){const mesh=this.meshes.get(name);if(active.has(mesh))highlighted.add(mesh);}
      this.outline.selectedObjects=[...highlighted];this.dirty=true;return;
    }
    const selected=this.selectedId!==this.rootId?this.selectedId:null;
    const id=selected||(this.mode==='operate'?stage?.nodeId:null)||this.hoveredId||null;
    const key=`${this.scopeId}:${id||''}:${this.hoveredId||''}`;
    if(this.outlineKey===key)return;
    this.outlineKey=key;const node=id&&this.nodes.get(id),active=new Set(this.active);
    // Hover is a quiet preview; it must not steal the selected part's accent.
    for(const mesh of this.hoverPreview||[])mesh.material.emissive.set(0x000000);
    this.hoverPreview=[];
    if(this.hoveredId&&this.hoveredId!==id)for(const name of this.nodes.get(this.hoveredId)?.meshNames||[]) {
      const mesh=this.meshes.get(name);if(active.has(mesh)){mesh.material.emissive.set('#242424');this.hoverPreview.push(mesh);}
    }
    this.outline.visibleEdgeColor.setHex(parseInt((selected||this.mode==='operate'?this.lineAccent||'#ff6840':'#c8cdd2').slice(1),16),THREE.LinearSRGBColorSpace);
    this.outline.selectedObjects=node?node.meshNames.map(name=>this.meshes.get(name)).filter(mesh=>active.has(mesh)):[];
    this.dirty=true;
  }
  setSelected(id) {if(!this.nodes.has(id))return;this.selectedId=id;this.hideHover();this.emitOperation(true);}
  highlight(id) {
    if(this.benchmark.active)return;this.hoveredId=this.nodes.has(id)&&id!==this.scopeId?id:null;this.refreshOutline();this.invalidate();
  }
  setIsolated(value) {this.cancelBenchmark('settings-changed');this.isolated=Boolean(value);this.updateContextVisibility();this.syncEdges();this.emitOperation(true);this.invalidate();}
  updateContextVisibility() {
    const node=this.nodes.get(this.scopeId),included=new Set(node.meshNames),parent=node.parent?this.nodes.get(node.parent):node;
    const context=new Set(!this.isolated&&node.parent?parent.meshNames:[]);this.contextMeshes=[];this.active=[];
    this.meshes.forEach(mesh=>{
      // Multiple translucent parent layers can overlap at close range. Six percent
      // preserves spatial context without competing with the fully opaque selection.
      const selected=included.has(mesh.name),ghost=!selected&&context.has(mesh.name),alpha=selected?1:ghost?.06:0;
      if(selected)this.active.push(mesh);else if(ghost)this.contextMeshes.push(mesh);
      mesh.userData.visibility.smoothTime=selected?.14:.065;mesh.userData.visibility.to([alpha],reducedMotion.matches);this.movingMeshes.add(mesh);
      if(alpha>0)mesh.visible=true;
    });
  }

  setScope(id) {
    if(!this.nodes.has(id))return;this.cancelBenchmark('user-input');this.separationAction?.clear(this.fraction);
    const restoring=this.mode==='operate'||Boolean(this.transformTransition)||Boolean(this.presentationPoseDetached);
    if(restoring){this.operationPlayer.pause();this.operationSampler?.restore();this.transformTransition=null;this.mode='explore';}
    if(id===this.scopeId&&!restoring){this.selectedId=id;this.hideHover();this.fit();this.emitOperation(true);return;}
    this.scopeViews.set(this.scopeId,{fraction:this.explosionTarget,direction:this.currentDirection(true)});
    const returning=ancestors(this.nodes,this.scopeId).some(node=>node.id===id),remembered=returning?this.scopeViews.get(id):null;
    const view=remembered?.direction||this.currentDirection();this.scopeId=id;this.selectedId=id;this.updateContextVisibility();
    const node=this.nodes.get(id);this.offsets=createOffsets(this.metadata.parts,this.nodes,id,this.scale,this.model.presentationPolicy);
    this.explosionTarget=node.type==='component'?0:remembered?.fraction||0;this.mode=this.explosionTarget>.001?'explode':'explore';
    this.separationMotion.to([this.explosionTarget],reducedMotion.matches);this.reportSeparation(this.separationMotion.values[0]);
    if(restoring)this.beginTransformTransition(this.restTargets(this.explosionTarget));else this.retargetPose(this.explosionTarget,reducedMotion.matches);
    this.syncEdges();this.hideHover();this.fit(true,view);this.emitOperation(true);this.invalidate();
  }

  retargetPose(value, immediate = false) {
    this.meshes.forEach(mesh => {
      const target = positionAt(mesh.userData.base,this.offsets.get(mesh.name),value);
      mesh.userData.pose.to(target,immediate);this.movingMeshes.add(mesh);
      if (immediate) mesh.position.fromArray(target);
    });
    if (immediate) this.edges.forEach((line,name) => line.position.copy(this.meshes.get(name).position));
  }

  reportSeparation(value) {
    this.fraction = Math.max(0,Math.min(1,value));
    this.callbacks.explosion?.(this.fraction);
  }

  applyFraction(value) {
    this.separationMotion.to([value],true); this.reportSeparation(value);
    this.retargetPose(value,true); this.invalidate();
  }

  getSeparationState() { return this.separationAction?.state() || { available:false, playing:false, progress:0, value:this.fraction, from:this.fraction, to:this.fraction, duration:this.model?.presentationPolicy?.actionDuration || 2.5 }; }

  explode(value, animate = true, requestedMode = null) {
    this.cancelBenchmark('user-input');
    const nextMode=requestedMode||(value>.001||this.mode==='explode'?'explode':'explore');
    if(this.mode==='operate'||this.transformTransition||this.presentationPoseDetached) this.leaveOperation(nextMode,animate?0:value,animate);
    this.mode=nextMode;
    this.separationAction ??= new SeparationPlayer(this.model?.presentationPolicy?.actionDuration || 2.5);
    this.explosionTarget = THREE.MathUtils.clamp(value,0,1);
    if (!animate) { this.separationAction.seekValue(value); this.applyFraction(value); }
    else if (reducedMotion.matches) { this.separationAction.start(this.fraction,value); this.separationAction.seek(1); this.applyFraction(value); }
    else {
      this.separationAction.start(this.fraction,this.explosionTarget);
      this.separationMotion.to([this.fraction],true);
      if(!this.transformTransition)this.retargetPose(this.fraction,true);
    }
    if (animate) this.fit(true,this.currentDirection(true));
    this.emitOperation(true);this.invalidate();
  }

  pauseSeparation() { this.pausePresentation(); }
  resumeSeparation({ replay=false } = {}) {
    const action=this.separationAction;
    if (!action?.state().available) return false;
    this.explosionTarget=action.to;
    if (reducedMotion.matches) { action.seek(1); this.applyFraction(action.to); }
    else {
      const detached=this.presentationPoseDetached;
      action.play({once:true,restart:replay});
      if(detached){this.operationSampler?.restore();this.beginTransformTransition(this.restTargets(action.state().value));}
      else if(replay)this.applyFraction(action.from);
    }
    this.fit(true,this.currentDirection(true));this.emitOperation(true);this.invalidate();return true;
  }
  stepSeparation(timestamp) {
    if(this.tourFrame||!this.separationAction?.tick(timestamp,{blocked:Boolean(this.transformTransition)}))return false;
    this.applyFraction(this.separationAction.state().value); this.emitOperation(); return true;
  }

  restTargets(fraction = 0) {
    return new Map([...this.meshes].map(([name,mesh])=>[name,{
      position:new THREE.Vector3().fromArray(positionAt(mesh.userData.base,this.offsets.get(name),fraction)),
      quaternion:mesh.userData.baseQuaternion.clone(),scale:mesh.userData.baseScale.clone()
    }]));
  }

  operationTargets(progress) {
    this.operationSampler.sample(progress);const targets=new Map(),matrix=new THREE.Matrix4();
    this.meshes.forEach((mesh,name)=>{
      const pose={position:new THREE.Vector3(),quaternion:new THREE.Quaternion(),scale:new THREE.Vector3()};
      this.operationSampler.matrixFor(mesh.userData.source,matrix).decompose(pose.position,pose.quaternion,pose.scale);targets.set(name,pose);
    });return targets;
  }

  copyDisplayPose(mesh, pose) {
    mesh.position.copy(pose.position);mesh.quaternion.copy(pose.quaternion);mesh.scale.copy(pose.scale);
    const line=this.edges.get(mesh.name);if(line){line.position.copy(mesh.position);line.quaternion.copy(mesh.quaternion);line.scale.copy(mesh.scale);}
  }

  beginTransformTransition(targets, animate = true, smoothTime = .16) {
    this.presentationPoseDetached=false;
    const from=new Map();
    for(const [name,target] of targets){const mesh=this.meshes.get(name);
      from.set(name,{position:mesh.position.clone(),quaternion:mesh.quaternion.clone(),scale:mesh.scale.clone()});
      // The ordinary explosion spring must not fight a full transform transition.
      mesh.userData.pose.to(target.position.toArray(),true);
    }
    this.transformTransition=null;
    if(!animate||reducedMotion.matches){for(const [name,target]of targets)this.copyDisplayPose(this.meshes.get(name),target);}
    else{const motion=new DampedMotion([0],smoothTime);motion.to([1]);this.transformTransition={from,targets,motion};}
    this.emitOperation(true);this.invalidate();
  }

  stepTransformTransition(seconds) {
    const transition=this.transformTransition;if(!transition)return false;
    if(!transition.motion.step(seconds))return false;
    const alpha=THREE.MathUtils.clamp(transition.motion.values[0],0,1);
    for(const [name,target]of transition.targets){const mesh=this.meshes.get(name),from=transition.from.get(name);
      mesh.position.lerpVectors(from.position,target.position,alpha);mesh.quaternion.slerpQuaternions(from.quaternion,target.quaternion,alpha);mesh.scale.lerpVectors(from.scale,target.scale,alpha);
      const line=this.edges.get(name);if(line){line.position.copy(mesh.position);line.quaternion.copy(mesh.quaternion);line.scale.copy(mesh.scale);}
    }
    if(!transition.motion.active){for(const [name,target]of transition.targets)this.copyDisplayPose(this.meshes.get(name),target);this.transformTransition=null;this.emitOperation(true);}
    this.dirty=true;return true;
  }

  applyOperationPose() {
    if(!this.operationSampler)return;
    for(const [name,target]of this.operationTargets(this.operationPlayer.state().progress)){
      const mesh=this.meshes.get(name);this.copyDisplayPose(mesh,target);mesh.userData.pose.to(target.position.toArray(),true);
    }
    this.dirty=true;
  }

  getOperationState() {
    return {...this.operationPlayer.state(),separation:this.getSeparationState(),sourceDuration:this.operationConfig?.duration,mode:this.mode,scopeId:this.scopeId,selectedId:this.selectedId,isolated:this.isolated,followCamera:this.followCamera,transitioning:Boolean(this.transformTransition)};
  }

  emitOperation(force = false) {
    if(this.disposed)return;
    const now=performance.now(),state=this.getOperationState();
    this.refreshOutline(state.stage);
    const key=[state.mode,state.playing,state.stage?.index,state.transitioning,state.scopeId,state.selectedId,state.isolated,state.followCamera,state.separation.playing,state.separation.progress===1].join(':');
    if(!force&&key===this.operationKey&&now-(this.lastOperationReport||0)<80)return;
    this.operationKey=key;this.lastOperationReport=now;this.callbacks.operation?.(state);
  }

  setMode(mode) {
    if(this.disposed)return false;
    if(mode==='explore'){this.explode(0,true,'explore');return true;}
    if(mode==='explode'){this.explode(1);return true;}
    if(mode!=='operate'||!this.operationPlayer.state().available)return false;
    if(this.mode==='operate')return true;
    this.cancelBenchmark('user-input');this.separationAction?.clear(this.fraction);this.setScope(this.rootId);
    this.isolated=false;this.updateContextVisibility();this.mode='operate';this.selectedId=this.rootId;this.followStage=null;
    this.explosionTarget=0;this.separationMotion.to([0],true);this.reportSeparation(0);this.operationPlayer.reset();
    this.beginTransformTransition(this.operationTargets(0));this.syncEdges();this.hideHover();
    this.fit(true,this.currentDirection(true));this.emitOperation(true);this.invalidate();return true;
  }

  leaveOperation(mode, fraction = 0, animate = true) {
    if(this.disposed)return;
    this.separationAction?.clear(this.fraction);this.operationPlayer.pause();this.operationSampler?.restore();this.mode=mode;
    this.hideHover();
    this.explosionTarget=THREE.MathUtils.clamp(fraction,0,1);this.separationMotion.to([this.explosionTarget],true);this.reportSeparation(this.explosionTarget);
    this.beginTransformTransition(this.restTargets(this.explosionTarget),animate);this.syncEdges();
    if(animate)this.fit(true,this.currentDirection(true));this.emitOperation(true);this.invalidate();
  }

  togglePlayback() {
    if(this.disposed)return false;
    if(this.mode!=='operate'&&!this.setMode('operate'))return false;
    this.cancelBenchmark('user-input');const replay=!this.operationPlayer.playing&&this.operationPlayer.state().progress>=1;
    this.operationPlayer.toggle({once:true});this.followStage=null;if(replay||this.presentationPoseDetached)this.beginTransformTransition(this.operationTargets(this.operationPlayer.state().progress));this.emitOperation(true);this.invalidate();return true;
  }

  setPlaybackProgress(fraction) {
    if(this.disposed)return;
    if(this.mode!=='operate'&&!this.setMode('operate'))return;
    this.cancelBenchmark('user-input');this.operationPlayer.seek(fraction);this.transformTransition=null;this.presentationPoseDetached=false;this.applyOperationPose();this.followStage=null;this.updateFollowCamera();this.emitOperation(true);this.invalidate();
  }

  setPlaybackSpeed(speed) {if(this.disposed)return;this.operationPlayer.setSpeed(speed);this.emitOperation(true);this.invalidate();}

  resetOperation() {
    if(this.disposed)return;
    if(this.mode!=='operate'&&!this.setMode('operate'))return;
    this.cancelBenchmark('user-input');this.operationPlayer.reset();this.followStage=null;this.beginTransformTransition(this.operationTargets(0));this.emitOperation(true);this.invalidate();
  }

  playOneCycle() {
    if(this.disposed)return;
    if(this.mode!=='operate'&&!this.setMode('operate'))return;
    this.cancelBenchmark('user-input');this.operationPlayer.play({once:true});this.followStage=null;this.beginTransformTransition(this.operationTargets(0));this.emitOperation(true);this.invalidate();
  }

  setFollowCamera(enabled) {
    if(this.disposed)return;
    this.followCamera=Boolean(enabled);this.followStage=null;
    if(this.followCamera)this.updateFollowCamera();else{this.cameraMotion?.stop();this.controls.enableDamping=true;}
    this.emitOperation(true);this.invalidate();
  }

  updateFollowCamera() {
    if(this.mode!=='operate'||!this.followCamera||this.transformTransition)return;
    const stage=this.operationPlayer.state().stage,index=stage?.index??-1;if(this.followStage===index)return;this.followStage=index;
    const node=stage?.nodeId&&this.nodes.get(stage.nodeId),meshes=node?node.meshNames.map(name=>this.meshes.get(name)).filter(Boolean):this.active;
    const direction=stage?.cameraDirection||this.operationConfig.cameraDirection;
    this.fitMeshes(meshes,true,direction?new THREE.Vector3(...direction).normalize():this.currentDirection(true));
  }

  /** Snapshot displayed poses, not spring destinations, so an interrupted tour is reversible. */
  capturePresentation() {
    return {
      scopeId:this.scopeId,selectedId:this.selectedId,isolated:this.isolated,mode:this.mode,technical:Boolean(this.technical),
      renderStyle:presentationStyle(this),
      explosion:this.fraction,operation:{...this.operationPlayer.state()},
      camera:{position:this.camera.position.toArray(),target:this.controls.target.toArray(),offsetX:this.offsetX||0,offsetY:this.offsetY||0,layoutKey:this.layoutRegion().key},
      scopeViews:new Map([...this.scopeViews].map(([id,view])=>[id,{fraction:view.fraction,direction:view.direction.clone()}])),
      poses:new Map([...this.meshes].map(([name,mesh])=>[name,{position:mesh.position.clone(),quaternion:mesh.quaternion.clone(),scale:mesh.scale.clone()}]))
    };
  }

  /** Freeze every presentation channel before giving OrbitControls back to the visitor. */
  pausePresentation() {
    this.cameraMotion?.stop();this.controls.enableDamping=true;this.followCamera=false;
    this.operationPlayer.pause();this.separationAction?.pause();this.separationMotion.to([this.fraction],true);this.explosionTarget=this.fraction;
    this.presentationPoseDetached=Boolean(this.presentationPoseDetached||this.transformTransition);this.transformTransition=null;
    for(const mesh of this.meshes.values()){
      mesh.userData.pose.to(mesh.position.toArray(),true);mesh.userData.visibility.stop();
    }
    this.tourPoseKey=null;this.tourCameraKey=null;this.emitOperation(true);this.invalidate();
  }

  leaveTour() {
    this.presentationRequest=(this.presentationRequest||0)+1;
    this.pausePresentation();this.tourFrame=null;this.tourPoseKey=null;this.tourCameraKey=null;this.outlineKey=null;
    this.refreshOutline();this.invalidate();
  }

  async restorePresentation(snapshot,{animate=true}={}) {
    if(!snapshot||this.disposed)return false;
    this.leaveTour();const request=this.presentationRequest;
    const renderStyle=presentationStyle(snapshot);
    if(renderStyle!=='engineering'&&!this.lineRuntime)await this.prepareEdges();
    if(this.disposed||request!==this.presentationRequest)return false;
    this.modeRequest=(this.modeRequest||0)+1;
    this.scopeId=this.nodes.has(snapshot.scopeId)?snapshot.scopeId:this.rootId;
    this.selectedId=this.nodes.has(snapshot.selectedId)?snapshot.selectedId:this.scopeId;
    this.isolated=Boolean(snapshot.isolated);this.renderStyle=renderStyle;this.technical=renderStyle!=='engineering';this.mode=snapshot.mode;
    this.scopeViews=new Map(snapshot.scopeViews);this.offsets=createOffsets(this.metadata.parts,this.nodes,this.scopeId,this.scale,this.model.presentationPolicy);
    this.separationAction?.clear(snapshot.explosion);this.operationPlayer.seek(snapshot.operation.progress);this.operationPlayer.setSpeed(snapshot.operation.speed);
    if(this.mode==='operate'&&this.operationSampler)this.operationSampler.sample(snapshot.operation.progress);
    else this.operationSampler?.restore();
    this.explosionTarget=snapshot.explosion;this.separationMotion.to([snapshot.explosion],true);this.reportSeparation(snapshot.explosion);
    this.updateContextVisibility();
    if(!animate||reducedMotion.matches)for(const mesh of this.meshes.values())mesh.userData.visibility.to(mesh.userData.visibility.target,true);
    this.beginTransformTransition(snapshot.poses,animate);this.syncEdges();this.resizeDrawingBuffer();
    const target=new THREE.Vector3().fromArray(snapshot.camera.target),offset=new THREE.Vector3().fromArray(snapshot.camera.position).sub(target);
    const layout=this.layoutRegion(),direction=offset.lengthSq()>.0001?offset.clone().normalize():this.defaultDirection.clone();
    if(snapshot.camera.layoutKey===layout.key){
      this.moveCamera(target,direction,Math.max(.3,offset.length()),{offsetX:snapshot.camera.offsetX,offsetY:snapshot.camera.offsetY},animate);
      this.lastLayoutKey=layout.key;
    }else{
      // Projection offsets are screen pixels. After rotation or panel changes,
      // preserve the view direction while fitting the restored poses to today's clear region.
      this.fitMeshes(this.active,animate,direction,snapshot.poses);
    }
    this.emitOperation(true);this.invalidate();return true;
  }

  /** A fully sampled frame has one owner; source playback never races the tour clock. */
  applyTourFrame(frame,{immediate=false}={}) {
    if(this.disposed||!frame||!this.nodes.has(frame.scopeId))return false;
    const renderStyle=presentationStyle(frame);
    if(renderStyle!=='engineering'&&!this.lineRuntime)throw new Error('Prepare linework before starting the tour.');
    const previous=this.tourFrame,reacquiring=!previous;
    const operation=Number.isFinite(frame.operationProgress)&&Boolean(this.operationSampler);
    const explosion=operation?0:THREE.MathUtils.clamp(frame.explosion||0,0,1);
    const mode=operation?'operate':frame.mode||(explosion>.001?'explode':'explore');
    const contextChanged=reacquiring||this.scopeId!==frame.scopeId||this.isolated!==Boolean(frame.isolated);
    const appearanceChanged=presentationStyle(this)!==renderStyle;
    const modeChanged=this.mode!==mode;
    this.presentationRequest=(this.presentationRequest||0)+1;this.modeRequest=(this.modeRequest||0)+1;
    this.tourFrame=frame;this.presentationPoseDetached=false;this.followCamera=false;this.hoveredId=null;
    this.scopeId=frame.scopeId;this.selectedId=this.nodes.has(frame.selectedId)?frame.selectedId:frame.scopeId;
    this.isolated=Boolean(frame.isolated);this.mode=mode;this.renderStyle=renderStyle;this.technical=renderStyle!=='engineering';
    if(contextChanged){this.offsets=createOffsets(this.metadata.parts,this.nodes,this.scopeId,this.scale,this.model.presentationPolicy);this.updateContextVisibility();}
    if(immediate)for(const mesh of this.meshes.values())mesh.userData.visibility.to(mesh.userData.visibility.target,true);
    if(contextChanged||appearanceChanged)this.syncEdges();
    if(appearanceChanged)this.resizeDrawingBuffer();
    this.operationPlayer.pause();this.separationAction?.clear(explosion);
    const progress=operation?THREE.MathUtils.clamp(frame.operationProgress,0,1):null;
    const poseKey=JSON.stringify([this.scopeId,explosion,progress,mode]);
    if(this.tourPoseKey!==poseKey){
      if(operation)this.operationPlayer.seek(progress);else if(modeChanged||reacquiring)this.operationSampler?.restore();
      const targets=operation?this.operationTargets(progress):this.restTargets(explosion);
      if(immediate||reducedMotion.matches){
        this.transformTransition=null;
        for(const [name,target]of targets){const mesh=this.meshes.get(name);this.copyDisplayPose(mesh,target);mesh.userData.pose.to(target.position.toArray(),true);}
      }else if(reacquiring||modeChanged||contextChanged){this.beginTransformTransition(targets,true,.12);}
      else if(this.transformTransition){
        this.transformTransition.targets=targets;
        for(const [name,target]of targets)this.meshes.get(name).userData.pose.to(target.position.toArray(),true);
      }else{
        for(const [name,target]of targets){const mesh=this.meshes.get(name);this.copyDisplayPose(mesh,target);mesh.userData.pose.to(target.position.toArray(),true);}
      }
      this.tourPoseKey=poseKey;this.dirty=true;
    }
    if(this.fraction!==explosion||this.separationMotion.active){this.separationMotion.to([explosion],true);this.reportSeparation(explosion);}
    this.explosionTarget=explosion;
    this.fitTourCamera(frame,!immediate);
    this.emitOperation();if(this.dirty)this.invalidate();return true;
  }

  fitTourCamera(frame,animate=true) {
    const descriptor=frame.camera||{};
    const operation=Number.isFinite(frame.operationProgress)&&Boolean(this.operationSampler);
    const focusId=this.nodes.has(descriptor.focusId)?descriptor.focusId:frame.scopeId;
    const key=JSON.stringify([frame.scopeId,focusId,descriptor.direction,descriptor.scale,descriptor.explosion,operation]);
    // Overlay/viewport changes explicitly invalidate this key through refitLayout.
    // Stable shots never read DOM rectangles or rebuild bounds on every clock tick.
    if(this.tourCameraKey===key)return;
    const layout=this.layoutRegion();this.tourCameraKey=key;this.lastLayoutKey=layout.key;
    const node=this.nodes.get(focusId),points=[];
    // Fit an authored envelope once per shot; neither crank phase nor explode scrubbing pumps the camera.
    for(const name of node.meshNames){
      const mesh=this.meshes.get(name);if(!mesh)continue;
      const cycle=operation&&mesh.userData.record?.cycleBounds;
      if(cycle&&this.normalization){
        for(const x of [cycle[0][0],cycle[1][0]])for(const y of [cycle[0][1],cycle[1][1]])for(const z of [cycle[0][2],cycle[1][2]])points.push(new THREE.Vector3(x,y,z).applyMatrix4(this.normalization));
      }else{
        const fraction=THREE.MathUtils.clamp(descriptor.explosion||0,0,1);
        // Include both rest and separated positions. A close-up can begin while
        // a group is displaced, then collapse into scope without cropping or a second camera move.
        for(const amount of fraction>0?[0,fraction]:[0]){
          const position=new THREE.Vector3().fromArray(positionAt(mesh.userData.base,this.offsets.get(name),amount));
          mesh.userData.fitCorners.forEach(corner=>points.push(corner.clone().add(position)));
        }
      }
    }
    if(!points.length)return;
    const direction=Array.isArray(descriptor.direction)?new THREE.Vector3(...descriptor.direction):this.defaultDirection.clone();
    if(direction.lengthSq()<.0001)direction.copy(this.defaultDirection);direction.normalize();
    const fit=fitProjectedPoints(points,direction,effectiveFov(this.camera),layout.width/layout.height,layout.region,layout);
    this.moveCamera(fit.center,direction,fit.distance*Math.max(1,descriptor.scale||1),layout.region,animate,.11);
  }

  projectTourAnchor(nodeId) {
    const node=this.nodes.get(nodeId);if(!node)return {x:0,y:0,visible:false};
    const meshes=node.meshNames.map(name=>this.meshes.get(name)).filter(mesh=>mesh?.visible&&mesh.userData.visibility.values[0]>.5);
    if(!meshes.length)return {x:0,y:0,visible:false};
    this.camera.updateMatrixWorld(true);
    const point=this.boxFor(meshes).getCenter(new THREE.Vector3()).project(this.camera);
    return {x:(point.x+1)*this.mount.clientWidth/2,y:(1-point.y)*this.mount.clientHeight/2,visible:point.z>=-1&&point.z<=1&&Math.abs(point.x)<=1&&Math.abs(point.y)<=1};
  }

  async loadEdgesBinary() {
    if(!this.model.edgesUrl)throw new Error('The model package has no prepared edge asset.');
    return loadBinary(this.model.edgesUrl,this.model.compressedEdgesUrl,undefined,{signal:this.abort.signal});
  }

  async prepareEdges({signal}={}) {
    throwIfAborted(this.abort?.signal);throwIfAborted(signal);
    if(this.disposed)throw new DOMException('Explorer disposed.','AbortError');
    if(this.lineRuntime)return;
    if(this.edgePromise)return abortable(this.edgePromise,this.abort.signal,signal);
    this.edgePromise=(async()=>{
      const start=performance.now();
      const contourMetadataUrl=this.model.silhouetteMetadataUrl;
      if(!contourMetadataUrl||!this.model.silhouettesUrl)throw new Error('This model has no prepared linework package.');
      if(!this.edgeBuffer&&!this.model.edgeMetadataUrl)throw new Error('The model package has no prepared edge metadata.');
      const [edgePackage,contourMetadataResponse,contourBinary,{createAssemblyLinework}]=await Promise.all([
        this.edgeBuffer?Promise.resolve({metadata:this.edgeMetadata,binary:this.edgeBuffer}):(async()=>{
          const [response,binary]=await Promise.all([fetch(this.model.edgeMetadataUrl,{signal:this.abort.signal}),this.loadEdgesBinary()]);
          if(!response.ok)throw new Error('Linework metadata unavailable');return {metadata:await response.json(),binary};
        })(),
        fetch(contourMetadataUrl,{signal:this.abort.signal}),this.loadContourBinary(),import('./assembly-linework.js')
      ]);
      throwIfAborted(this.abort.signal);if(this.disposed)return;
      if(!contourMetadataResponse.ok)throw new Error('Contour metadata unavailable');
      const contourMetadata=await contourMetadataResponse.json();
      throwIfAborted(this.abort.signal);if(this.disposed)return;
      this.edgeMetadata=edgePackage.metadata;this.edgeBuffer=edgePackage.binary;
      this.loadMetrics.edgeFetchMs=performance.now()-start;this.loadMetrics.edgeBytes=this.edgeBuffer.byteLength;
      this.edgeGeometries??=new Map();
      const runtime=await createAssemblyLinework({meshes:[...this.meshes.values()],edgeMetadata:this.edgeMetadata,edgeBuffer:this.edgeBuffer,camera:this.camera,silhouetteMetadata:contourMetadata,silhouetteBuffer:contourBinary,signal:this.abort.signal,onProgress:value=>{if(!this.disposed&&!this.abort.signal.aborted)this.callbacks.edgeProgress?.(value);}});
      if(this.disposed||this.abort.signal.aborted){runtime.dispose();throwIfAborted(this.abort.signal);return;}
      this.lineRuntime=runtime;runtime.pass.enabled=false;
      this.composer.insertPass(runtime.pass,this.composer.passes.indexOf(this.fxaa));
      this.loadMetrics.linePreparationMs=runtime.stats.prepareMs;this.benchmark.recordLoadMetric?.('linePreparationMs',runtime.stats.prepareMs);
      this.callbacks.edgeStatus?.('ready');this.syncEdges();this.resizeDrawingBuffer();
    })().catch(error=>{this.edgePromise=null;if(!this.disposed&&!this.abort.signal.aborted)this.callbacks.edgeStatus?.('error');throw error;});
    return abortable(this.edgePromise,this.abort.signal,signal);
  }

  async loadContourBinary(){
    return loadBinary(this.model.silhouettesUrl,this.model.compressedSilhouettesUrl,undefined,{signal:this.abort.signal});
  }

  ensureEdge(mesh) {
    if(this.edges.has(mesh.name))return this.edges.get(mesh.name);
    const record=this.edgeMetadata?.meshes[mesh.name];if(!record)return null;
    let geometry=this.edgeGeometries.get(record.byteOffset);
    if(!geometry){geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(this.edgeBuffer,record.byteOffset,record.vertexCount*3),3));geometry.computeBoundingSphere();this.edgeGeometries.set(record.byteOffset,geometry);}
    this.technicalLineMaterial??=new THREE.LineBasicMaterial({color:technicalSpec().lineColor,transparent:true,opacity:.8,depthWrite:false});
    this.contextLineMaterial??=new THREE.LineBasicMaterial({color:'#8a8d92',transparent:true,opacity:.1,depthWrite:false});
    const line=new THREE.LineSegments(geometry,this.technicalLineMaterial);
    line.position.copy(mesh.position);line.quaternion.copy(mesh.quaternion);line.scale.copy(mesh.scale);
    this.edges.set(mesh.name,line);this.scene.add(line);return line;
  }

  syncEdges() {
    if(this.disposed)return;
    this.edges.forEach(line=>line.visible=false);
    const engineering=presentationStyle(this)==='engineering';
    if(engineering)for(const mesh of this.contextMeshes){const line=this.ensureEdge(mesh);if(line){line.visible=true;line.material=this.contextLineMaterial;}}
    this.meshes.forEach(mesh=>{
      mesh.material.color.copy(mesh.userData.color);mesh.material.metalness=mesh.userData.metalness;mesh.material.roughness=mesh.userData.roughness;
      mesh.material.polygonOffset=false;
    });
    this.surfacePass.enabled=engineering;this.outputPass.enabled=engineering;this.outline.enabled=engineering;this.fxaa.enabled=engineering;this.copyPass.enabled=!engineering;
    if(this.lineRuntime)this.lineRuntime.pass.enabled=!engineering;
    if(this.grid)this.grid.visible=engineering&&Boolean(this.displayOptions?.grid);
    this.ao.enabled=engineering&&this.displayOptions?.ambientOcclusion!==false&&QUALITY_PROFILES[this.effectiveQuality].aoScale>0;
    this.mount.dataset.renderStyle=presentationStyle(this);
    if(engineering)this.mount.dataset.flatPartCount='0';
    if(this.reportedRenderStyle!==presentationStyle(this)){
      this.reportedRenderStyle=presentationStyle(this);
      const key=this.reportedRenderStyle==='linework'?'firstLineworkMs':this.reportedRenderStyle==='flat'?'firstFlatMs':null;
      this.firstStyleFrame=key&&!this.loadMetrics[key]?{key,started:performance.now()}:null;
      this.firstTechnicalStarted=!engineering&&!this.loadMetrics.firstTechnicalMs?performance.now():null;
      this.callbacks.renderStyle?.(this.reportedRenderStyle);
    }
    this.invalidate();
  }

  setDisplayOptions(patch) {
    this.displayOptions=displayOptions(patch,this.displayOptions);this.cancelBenchmark('settings-changed');
    this.syncEdges();this.invalidate();return {...this.displayOptions};
  }

  async setRenderStyle(style) {
    if(this.disposed||!RENDER_STYLES.has(style))return false;
    this.cancelBenchmark('settings-changed');const request=(this.modeRequest||0)+1;this.modeRequest=request;
    if(style!=='engineering'&&!this.lineRuntime){this.callbacks.edgeStatus?.('loading');await this.prepareEdges();}
    if(this.disposed||this.modeRequest!==request)return false;
    // A measurement may have started while first-use linework was downloading.
    this.cancelBenchmark('settings-changed');
    this.renderStyle=style;this.technical=style!=='engineering';this.syncEdges();this.resizeDrawingBuffer();return true;
  }
  setTechnical(enabled){return this.setRenderStyle(enabled?'linework':'engineering');}

  /** Reuse source transforms and the existing visibility springs; no line topology is rebuilt. */
  syncLinePresentation(){
    if(!this.lineRuntime||presentationStyle(this)==='engineering')return;
    const state=this.lineState??={active:new Set(),context:new Set(),highlighted:new Set(),hovered:new Set(),filled:new Set(),perPartAlpha:new Map()};
    for(const key of ['active','context','highlighted','hovered','filled'])state[key].clear();state.perPartAlpha.clear();
    for(const mesh of this.active)state.active.add(mesh.name);
    for(const mesh of this.contextMeshes)state.context.add(mesh.name);
    const emphasisIds=this.tourFrame?(this.tourFrame.highlightIds||[]):this.selectedId!==this.rootId?[this.selectedId]:this.mode==='operate'?[this.operationPlayer.state().stage?.nodeId]:[];
    for(const id of emphasisIds)for(const name of this.nodes.get(id)?.meshNames||[])if(state.active.has(name))state.highlighted.add(name);
    if(!this.tourFrame)for(const name of this.nodes.get(this.hoveredId)?.meshNames||[])if(state.active.has(name))state.hovered.add(name);
    if(presentationStyle(this)==='flat'){
      // The director's empty highlight is deliberate. Never substitute its selected scope.
      const stageId=this.mode==='operate'?this.operationPlayer.state().stage?.nodeId:null;
      const ids=this.tourFrame?(this.tourFrame.highlightIds||[]):this.selectedId!==this.rootId?[this.selectedId]:stageId?[stageId]:[];
      for(const id of ids)for(const name of this.nodes.get(id)?.meshNames||[])if(state.active.has(name))state.filled.add(name);
    }
    for(const mesh of this.meshes.values())state.perPartAlpha.set(mesh.name,THREE.MathUtils.clamp(mesh.userData.visibility.values[0],0,1));
    state.displayOptions=this.displayOptions;state.renderStyle=presentationStyle(this);state.accent=this.lineAccent||this.callbacks.theme?.outline||'#ff6840';state.worldMatricesUpdated=true;
    // The original scene is not rendered in line styles, so update its world matrices explicitly.
    this.scene.updateMatrixWorld(true);this.lineRuntime.sync(state);
    this.mount.dataset.flatPartCount=String(state.filled.size);this.mount.dataset.lineBatchCount=String(this.lineRuntime.stats.lineBatchCount);
  }
  pauseCamera(){this.cancelBenchmark('user-input');this.cameraMotion?.stop();this.controls.enableDamping=true;this.followCamera=false;this.emitOperation(true);}
  hideHover(){this.hoveredId=null;this.callbacks.hover?.(null);this.refreshOutline();this.invalidate();}

  addPicking() {
    const canvas = this.renderer.domElement;
    const hit = e => {
      const rect = canvas.getBoundingClientRect(); this.pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
      this.raycaster.setFromCamera(this.pointer,this.camera);
      const result = this.raycaster.intersectObjects(this.active,false)[0];
      return result ? childForMesh(this.nodes,this.scopeId,result.object.name) : null;
    };
    const pointers = new Set();
    const listen=(type,handler)=>canvas.addEventListener(type,handler,{signal:this.abort.signal});
    listen('dblclick',e=>{if(!this.ready||this.benchmark.active)return;const node=hit(e);if(node&&node.id!==this.scopeId){this.callbacks.interact?.('inspect');this.callbacks.inspect?.(node.id);}});
    listen('pointerdown',e => { pointers.add(e.pointerId); if(pointers.size>1||e.button!==0||!e.isPrimary){this.pointerDown=null;return;} this.pointerDown = { x:e.clientX,y:e.clientY,id:e.pointerId }; });
    listen('pointerup',e => {
      pointers.delete(e.pointerId); const down = this.pointerDown; this.pointerDown = null;
      if (!this.ready || this.benchmark.active || !down || down.id !== e.pointerId || Math.hypot(e.clientX-down.x,e.clientY-down.y)>5) return;
      const node = hit(e); if (node && node.id !== this.scopeId) this.callbacks.select?.(node.id);
    });
    listen('pointercancel',e => { pointers.delete(e.pointerId); this.pointerDown = null; });
    listen('pointermove',e => {
      if (!this.ready || this.benchmark.active || e.buttons || e.pointerType === 'touch') return;
      const now = performance.now(); if (now - (this.lastPick || 0) < 65) return; this.lastPick = now;
      const node = hit(e); const rect = canvas.getBoundingClientRect();
      this.callbacks.hover?.(node && node.id !== this.scopeId ? node : null, { x:e.clientX-rect.left,y:e.clientY-rect.top });
      this.highlight(node?.id);
      canvas.style.cursor = node && node.id !== this.scopeId ? 'pointer' : 'grab'; this.invalidate();
    });
    listen('pointerleave',() => this.hideHover());
  }

  setQuality(value){
    this.cancelBenchmark('settings-changed');this.quality=Object.hasOwn(QUALITY_PROFILES,value)?value:'balanced';this.effectiveQuality=this.quality;this.adaptive.reset();this.resizeDrawingBuffer();this.syncEdges();this.callbacks.quality?.(this.quality,this.effectiveQuality);
  }
  resizeDrawingBuffer(){
    if(this.disposed)return;
    const width=this.mount.clientWidth,height=this.mount.clientHeight;if(!width||!height)return;
    const profile=QUALITY_PROFILES[this.effectiveQuality],ratio=renderPixelRatio({quality:this.effectiveQuality,renderStyle:presentationStyle(this),width,height,devicePixelRatio});
    this.renderer.setPixelRatio(ratio);this.renderer.setSize(width,height);this.composer.setPixelRatio(ratio);this.composer.setSize(width,height);
    this.ao.setSize(Math.round(width*ratio*(profile.aoScale||.5)),Math.round(height*ratio*(profile.aoScale||.5)));
    this.outline.downSampleRatio=1/profile.outlineScale;this.outline.setSize(width*ratio,height*ratio);
    this.fxaa.material.uniforms.resolution.value.set(1/(width*ratio),1/(height*ratio));this.lineRuntime?.resize(width,height,ratio);
    this.mount.dataset.pixelRatio=String(ratio);this.invalidate();
  }
  resize(){
    if(this.disposed)return;
    const width=this.mount.clientWidth,height=this.mount.clientHeight;if(!width||!height)return;
    this.cancelBenchmark('settings-changed');this.resizeDrawingBuffer();this.camera.aspect=width/height;this.camera.updateProjectionMatrix();
    if(this.ready)this.refitLayout(false);this.invalidate();
  }

  startBenchmark(){
    if(!this.ready||this.benchmark.active)return;
    if(this.mode==='operate'||this.transformTransition)this.leaveOperation('explore',0,false);
    this.setScope(this.rootId);this.callbacks.benchmarkScope?.();this.applyFraction(0);this.explosionTarget=0;this.mode='explore';this.emitOperation(true);
    this.meshes.forEach(mesh=>{mesh.userData.visibility.to([1],true);mesh.visible=true;mesh.material.opacity=mesh.userData.baseOpacity;mesh.material.transparent=mesh.userData.baseTransparent;mesh.material.depthWrite=mesh.userData.baseDepthWrite;mesh.material.needsUpdate=true;});
    this.fit(false,this.defaultDirection);this.outline.selectedObjects=[];
    // Exercise selection rendering too: an unselected Engineering run skips the
    // outline pass and would under-report the cost of actually inspecting parts.
    if(['flat','engineering'].includes(presentationStyle(this))){
      const stageId=this.operationConfig?.stages?.[0]?.nodeId||this.metadata.operation?.stages?.[0]?.nodeId;
      const focus=this.nodes.get(stageId)||[...this.nodes.values()].find(node=>node.id!==this.rootId&&node.type!=='component');
      if(focus){this.selectedId=focus.id;this.outlineKey=null;this.refreshOutline();this.callbacks.benchmarkSelection?.(focus.id);}
    }
    this.syncLinePresentation();
    const layout=this.layoutRegion(),renderStyle=presentationStyle(this),stats=this.metadata.stats||{};
    this.benchmark.begin({modelId:this.model.id||'unknown',mode:renderStyle,renderStyle,quality:this.effectiveQuality,displayOptions:this.displayOptions,viewport:{width:layout.width,height:layout.height,pixelRatio:this.renderer.getPixelRatio(),renderWidth:this.renderer.domElement.width,renderHeight:this.renderer.domElement.height},modelStats:{...stats,glbBytes:stats.glbBytes||stats.bytes,edgeBytes:this.edgeBuffer?.byteLength||0,...this.lineRuntime?.stats,selectedPartCount:this.outline.selectedObjects.length,flatPartCount:renderStyle==='flat'?this.lineState?.filled.size||0:0},loadMetrics:this.loadMetrics});
    this.benchmarkStarted=performance.now();this.benchmarkBase=this.cameraMotion.values.slice();this.controls.enabled=false;this.invalidate();
  }
  cancelBenchmark(reason='cancelled'){
    if(!this.benchmark.active)return;const report=this.benchmark.cancel(reason);this.benchmarkStarted=null;this.controls.enabled=true;this.callbacks.report?.(report);this.invalidate();
  }

  dispose() {
    if(this.disposed)return;this.disposed=true;this.modeRequest=(this.modeRequest||0)+1;this.presentationRequest=(this.presentationRequest||0)+1;
    if(this.raf!==null)cancelAnimationFrame(this.raf);this.raf=null;
    this.abort.abort();this.resizeObserver.disconnect();this.controls.dispose();this.separationAction?.pause();this.operationPlayer.pause();this.operationSampler?.dispose();
    this.benchmark.cancel?.('cancelled');this.benchmarkStarted=null;
    for(const waiter of this.settleWaiters||[])waiter.finish(new DOMException('Explorer disposed.','AbortError'));
    this.firstFrame?.();this.firstFrame=null;
    if(this.lineRuntime){this.composer.removePass(this.lineRuntime.pass);this.lineRuntime.dispose();this.lineRuntime=null;}
    disposeObjectResources([this.scene,this.sourceRoot],this.edgeGeometries?.values());
    for(const pass of this.composer.passes)pass.dispose?.();this.composer.dispose();this.environmentTarget.dispose();
    this.renderer.dispose();this.renderer.forceContextLoss();this.renderer.domElement.remove();
    this.meshes.clear();this.edges.clear();this.movingMeshes.clear();this.active=[];this.contextMeshes=[];
  }

  frame(time) {
    this.raf=null;if(this.disposed)return;
    if(document.hidden){if(this.benchmarkStarted){this.controls.enabled=true;this.callbacks.report?.(this.benchmark.lastReport);this.benchmarkStarted=null;}return;}
    const tourPlaying=Boolean(this.callbacks.tourTick?.(time));
    if(this.disposed)return;
    const elapsed=time-(this.lastFrame??time),seconds=Math.min(.1,Math.max(0,elapsed/1000));this.lastFrame=time;
    let phase='inspect';
    if(this.benchmark.active){
      const t=(performance.now()-this.benchmarkStarted)/1000,fraction=t<4?0:t<8?(t-4)/4:Math.max(0,1-(t-8)/4);phase=t<4?'orbit':t<8?'explode':'reassemble';
      this.applyFraction(fraction);const values=this.benchmarkBase.slice();values[3]+=.58*Math.sin(t*Math.PI/6);values[5]+=Math.log(1+fraction*.4);
      this.cameraMotion.to(values,true);this.applyCamera();this.callbacks.benchmarkProgress?.(Math.min(1,t/12));
      if(t>=12){this.applyFraction(0);this.controls.enabled=true;const report=this.benchmark.finish();this.benchmarkStarted=null;this.callbacks.report?.(report);}
    }else if(this.benchmarkStarted){this.benchmarkStarted=null;this.controls.enabled=true;this.callbacks.report?.(this.benchmark.lastReport);}
    let posesMoving=false;
    for(const mesh of this.movingMeshes){
      const pose=mesh.userData.pose,visibility=mesh.userData.visibility;
      if(pose.step(seconds)){mesh.position.fromArray(pose.values);this.edges.get(mesh.name)?.position.copy(mesh.position);this.dirty=true;}
      const visibilityMoved=visibility.step(seconds),alpha=Math.max(0,Math.min(1,visibility.values[0]));
      if(visibilityMoved||mesh.visible!==(alpha>.001)||mesh.material.opacity!==mesh.userData.baseOpacity*alpha){
        mesh.visible=alpha>.001;const transparent=mesh.userData.baseTransparent||alpha<.999;
        if(transparent!==mesh.material.transparent){mesh.material.transparent=transparent;mesh.material.needsUpdate=true;}
        mesh.material.opacity=mesh.userData.baseOpacity*alpha;mesh.material.depthWrite=mesh.userData.baseDepthWrite&&alpha>.98;this.dirty=true;
      }
      if(pose.active||visibility.active)posesMoving=true;else this.movingMeshes.delete(mesh);
    }
    const transformMoving=this.stepTransformTransition(seconds);
    this.stepSeparation(time);
    if(this.mode==='operate'&&!this.tourFrame){const advanced=this.operationPlayer.tick(time,{blocked:Boolean(this.transformTransition)});if(advanced){this.applyOperationPose();this.dirty=true;}this.updateFollowCamera();this.emitOperation();}
    if(this.separationMotion.step(seconds))this.reportSeparation(this.separationMotion.values[0]);
    if(this.cameraMotion?.step(seconds)){this.applyCamera();this.dirty=true;}
    if(!this.cameraMotion?.active)this.controls.enableDamping=true;
    const controlsMoving=this.controls.update();this.controlsMoving=controlsMoving;
    const moving=Boolean(transformMoving||this.transformTransition||this.separationAction?.playing||this.mode==='operate'&&this.operationPlayer.playing||posesMoving||this.cameraMotion?.active||this.separationMotion.active||this.benchmark.active||controlsMoving);
    this.mount.dataset.motion=moving?'moving':'settled';
    let renderMs=null;
    if(this.dirty){
      this.dirty=false;this.syncLinePresentation();this.renderer.info.reset();const start=performance.now();this.composer.render();renderMs=performance.now()-start;
      if(this.firstFrame){this.firstFrame();this.firstFrame=null;}
      if(this.firstTechnicalStarted){this.loadMetrics.firstTechnicalMs=performance.now()-this.firstTechnicalStarted;this.benchmark.recordLoadMetric('firstTechnicalMs',this.loadMetrics.firstTechnicalMs);this.firstTechnicalStarted=null;}
      if(this.firstStyleFrame){const {key,started}=this.firstStyleFrame;this.loadMetrics[key]=performance.now()-started;this.benchmark.recordLoadMetric(key,this.loadMetrics[key]);this.firstStyleFrame=null;}
      const inverse=this.camera.quaternion.clone().invert();
      this.axisElements.forEach(({line,label,vector})=>{const v=vector.clone().applyQuaternion(inverse),x=v.x*16,y=-v.y*16;if(line){line.style.transform=`rotate(${Math.atan2(y,x)}rad)`;line.style.width=Math.hypot(x,y)+'px';}if(label){label.style.left=(10+x*1.35)+'px';label.style.top=(23+y*1.35-4)+'px';}});
      this.renderCount=(this.renderCount||0)+1;this.mount.dataset.renderedFrames=this.renderCount;this.mount.dataset.renderStyle=presentationStyle(this);
      this.mount.dataset.drawCalls=String(this.renderer.info.render.calls);this.mount.dataset.triangles=String(this.renderer.info.render.triangles);this.mount.dataset.lines=String(this.renderer.info.render.lines);
      this.mount.dataset.cameraState=JSON.stringify({position:this.camera.position.toArray(),target:this.controls.target.toArray(),offset:[this.offsetX||0,this.offsetY||0],fov:this.camera.fov});
      this.callbacks.frame?.();
      if(this.disposed)return;
    }
    this.flushSettledWaiters();
    this.benchmark.frame(time,{renderMs,drawCalls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,lines:this.renderer.info.render.lines,moving,phase});
    if(!this.benchmark.active&&this.quality==='balanced'&&this.effectiveQuality==='balanced'&&this.adaptive.observe(elapsed,moving)){
      this.effectiveQuality='performance';this.resizeDrawingBuffer();this.syncEdges();this.callbacks.quality?.(this.quality,this.effectiveQuality);
    }
    if(moving)this.invalidate();
    else if(tourPlaying&&this.raf===null)this.raf=requestAnimationFrame(this.frame);
  }
}
