import * as THREE from 'three';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { DISPLAY_DEFAULTS, LINE_WEIGHTS } from './display-profiles.js';
import { contourRecord } from './assembly-linework-data.js';

export const ASSEMBLY_LINE_WIDTHS = Object.freeze({ crease: 1.05, contour: 1.8 });
const PALETTE_COLUMNS = 8, FLOATS_PER_PART = PALETTE_COLUMNS * 4, COVERAGE_WIDTH = .75;
const yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0));
const abortIfNeeded = signal => { if (signal?.aborted) throw signal.reason || new DOMException('Line preparation interrupted.', 'AbortError'); };

/** One texture row per source part: affine matrix, inverse-transpose normal matrix, state. */
export class PartTransformPalette {
  constructor(meshes) {
    this.meshes = meshes;
    this.data = new Float32Array(Math.max(1, meshes.length) * FLOATS_PER_PART);
    this.texture = new THREE.DataTexture(this.data, PALETTE_COLUMNS, Math.max(1, meshes.length), THREE.RGBAFormat, THREE.FloatType);
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.normal = new THREE.Matrix3();
    this.uploads = 0;
  }

  sync({ active = new Set(), context = new Set(), highlighted = new Set(), hovered = new Set(), filled = new Set(), renderStyle = 'linework', perPartAlpha, worldMatricesUpdated = false } = {}) {
    let dirty = false, flatPartCount = 0, activePartCount = 0, contextPartCount = 0;
    const write = (index, value) => {
      const next = Math.fround(value);
      if (this.data[index] !== next) { this.data[index] = next; dirty = true; }
    };
    for (let i = 0; i < this.meshes.length; i++) {
      const mesh = this.meshes[i], base = i * FLOATS_PER_PART;
      // The scene updates its hierarchy once before sync. Standalone callers may
      // pass detached meshes, so update the local/world matrix without traversing children.
      if (!worldMatricesUpdated) mesh.updateWorldMatrix(true, false);
      const matrix = mesh.matrixWorld.elements;
      let transformChanged = false;
      for (let n = 0; n < 16; n++) {
        if (!Number.isFinite(matrix[n])) throw new Error(`Invalid linework transform: ${mesh.name}`);
        if (this.data[base + n] !== Math.fround(matrix[n])) transformChanged = true;
        write(base + n, matrix[n]);
      }
      if (transformChanged) {
        this.normal.getNormalMatrix(mesh.matrixWorld);
        for (let column = 0; column < 3; column++) for (let row = 0; row < 3; row++) write(base + 16 + column * 4 + row, this.normal.elements[column * 3 + row]);
      }
      const isActive = active.has(mesh.name), isContext = !isActive && context.has(mesh.name);
      const suppliedAlpha = perPartAlpha?.get(mesh.name);
      const alpha = mesh.visible && (isActive || isContext) ? Math.max(0, Math.min(1, Number.isFinite(suppliedAlpha) ? suppliedAlpha : isActive ? 1 : .06)) : 0;
      const fill = renderStyle === 'flat' && isActive && filled.has(mesh.name) && alpha > .001;
      write(base + 19, isActive && hovered.has(mesh.name) ? 1 : 0);
      write(base + 28, alpha); write(base + 29, isActive ? 1 : 0);
      write(base + 30, isActive && highlighted.has(mesh.name) ? 1 : 0); write(base + 31, fill ? 1 : 0);
      if (alpha > .001) { if (isActive) activePartCount++; else if (isContext) contextPartCount++; }
      if (fill) flatPartCount++;
    }
    if (dirty) { this.texture.needsUpdate = true; this.uploads++; }
    return { dirty, flatPartCount, activePartCount, contextPartCount, paletteUploads: this.uploads };
  }
  dispose() { this.texture.dispose(); }
}

const paletteShader = `
  uniform sampler2D partPalette;
  uniform float partRows;
  attribute float partIndex;
  vec4 partTexel(float column) { return texture2D(partPalette, vec2((column+0.5)/8.0, (partIndex+0.5)/partRows)); }
  mat4 partMatrix() { return mat4(partTexel(0.0), partTexel(1.0), partTexel(2.0), partTexel(3.0)); }
  mat3 partNormalMatrix() { return mat3(partTexel(4.0).xyz, partTexel(5.0).xyz, partTexel(6.0).xyz); }
`;

function paletteUniforms(palette) {
  return { partPalette: { value: palette.texture }, partRows: { value: Math.max(1, palette.meshes.length) } };
}

function surfaceMaterial(palette, flat, accent) {
  return new THREE.ShaderMaterial({
    uniforms: { ...paletteUniforms(palette), accent: { value: accent } },
    vertexShader: `${paletteShader}
      varying vec4 partState;
      void main() {
        partState=partTexel(7.0);
        if(partState.x<=0.001 || partState.y<0.5 ${flat ? '|| partState.w<0.5' : ''}) {
          gl_Position=vec4(2.0,2.0,2.0,1.0); return;
        }
        gl_Position=projectionMatrix*viewMatrix*partMatrix()*vec4(position,1.0);
      }`,
    fragmentShader: `uniform vec3 accent; varying vec4 partState;
      void main() {
        if(partState.x<=0.001 || partState.y<0.5 ${flat ? '|| partState.w<0.5' : ''}) discard;
        gl_FragColor=vec4(accent, ${flat ? 'partState.x' : '1.0'});
      }`,
    colorWrite: flat, depthWrite: !flat, depthTest: true, transparent: flat,
    side: THREE.DoubleSide, forceSinglePass: true, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
  });
}

function ribbonMaterial(palette, contour, accent, contextOnly = false, hiddenOnly = false) {
  const width = contour ? ASSEMBLY_LINE_WIDTHS.contour : ASSEMBLY_LINE_WIDTHS.crease;
  const material = new THREE.ShaderMaterial({
    uniforms: { ...paletteUniforms(palette), accent: { value: accent }, resolution: { value: new THREE.Vector2(1, 1) }, lineWidth: { value: width }, pixelRatio: { value: 1 } },
    vertexShader: `${paletteShader}
      attribute vec3 segmentStart;
      attribute vec3 segmentEnd;
      ${contour ? `attribute vec2 edgeNormalA; attribute vec2 edgeNormalB;
        vec3 octNormal(vec2 encoded) {
          vec3 normal=vec3(encoded,1.0-abs(encoded.x)-abs(encoded.y));
          if(normal.z<0.0) normal.xy=(1.0-abs(normal.yx))*vec2(normal.x>=0.0?1.0:-1.0,normal.y>=0.0?1.0:-1.0);
          return normalize(normal);
        }` : ''}
      uniform vec2 resolution;
      uniform float lineWidth;
      uniform float pixelRatio;
      varying vec4 partState;
      varying vec2 strokePointTimesW;
      varying float strokeW;
      varying float strokeLength;
      varying float hoverState;
      void main() {
        partState=partTexel(7.0);hoverState=partTexel(4.0).w;
        strokePointTimesW=vec2(1000.0); strokeW=1.0; strokeLength=0.0;
        // Parent context uses silhouettes only. Dense hidden crease bundles can
        // otherwise accumulate into bright spots even at a low per-part opacity.
        if(partState.x<=0.001 || partState.y${contextOnly ? '>' : '<'}0.5) { gl_Position=vec4(2.0,2.0,2.0,1.0); return; }
        ${hiddenOnly ? 'if(partState.z<0.5) { gl_Position=vec4(2.0,2.0,2.0,1.0); return; }' : ''}
        mat4 world=partMatrix();
        mat4 modelView=viewMatrix*world;
        ${contour ? `
          vec3 viewPoint=(modelView*vec4((segmentStart+segmentEnd)*0.5,1.0)).xyz;
          vec3 towardCamera=normalize(-viewPoint);
          mat3 viewNormal=mat3(viewMatrix)*partNormalMatrix();
          float first=dot(normalize(viewNormal*octNormal(edgeNormalA)),towardCamera);
          float second=dot(normalize(viewNormal*octNormal(edgeNormalB)),towardCamera);
          if(first*second>0.0) { gl_Position=vec4(2.0,2.0,2.0,1.0); return; }
        ` : ''}
        vec4 start=projectionMatrix*modelView*vec4(segmentStart,1.0);
        vec4 end=projectionMatrix*modelView*vec4(segmentEnd,1.0);
        if(start.w<=0.0001 || end.w<=0.0001) { gl_Position=vec4(2.0,2.0,2.0,1.0); return; }
        vec2 delta=(end.xy/end.w-start.xy/start.w)*resolution*0.5;
        float lengthPixels=length(delta);
        vec2 along=lengthPixels>0.0001?delta/lengthPixels:vec2(1.0,0.0);
        vec2 across=vec2(-along.y,along.x);
        float halfWidth=(lineWidth+${COVERAGE_WIDTH})*0.5;
        vec2 offset=across*position.x*halfWidth+along*(position.y*2.0-1.0)*halfWidth;
        vec4 projected=mix(start,end,position.y);
        projected.xy+=offset*2.0/resolution*projected.w;
        gl_Position=projected;
        // Recover screen-linear analytic coverage despite perspective interpolation.
        strokePointTimesW=vec2(position.x*halfWidth,position.y*lengthPixels+(position.y*2.0-1.0)*halfWidth)*projected.w;
        strokeW=projected.w; strokeLength=lengthPixels;
      }`,
    fragmentShader: `
      uniform vec3 accent;
      uniform float lineWidth;
      uniform float pixelRatio;
      varying vec4 partState;
      varying vec2 strokePointTimesW;
      varying float strokeW;
      varying float strokeLength;
      varying float hoverState;
      void main() {
        if(partState.x<=0.001 || partState.y${contextOnly ? '>' : '<'}0.5) discard;
        vec2 point=strokePointTimesW/strokeW;
        float beyond=max(0.0,max(-point.y,point.y-strokeLength));
        float distanceToStroke=length(vec2(point.x,beyond));
        float coverage=1.0-smoothstep(max(0.0,lineWidth*0.5-${COVERAGE_WIDTH * .5}),lineWidth*0.5+${COVERAGE_WIDTH * .5},distanceToStroke);
        if(coverage<=0.0) discard;
        vec3 color=${contour ? 'vec3(229.0,232.0,235.0)' : 'vec3(150.0,157.0,165.0)'}/255.0;
        if(hoverState>0.5) color=vec3(1.0);
        if(partState.w>0.5) color=vec3(1.0);
        ${hiddenOnly ? 'if(partState.z<0.5 || mod(point.y/pixelRatio,8.0)>4.0) discard; coverage*=0.42;' : ''}
        ${contextOnly ? `
          // Resolve coverage against the fixed display background before MAX
          // blending. Overlapping context never adds opacity or brightness.
          gl_FragColor=vec4(mix(vec3(27.0/255.0),color,partState.x*coverage),1.0);
        ` : `
          if(partState.z>0.5 && partState.w<0.5) color=accent;
          gl_FragColor=vec4(color,partState.x*coverage);
        `}
      }`,
    transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, toneMapped: false
  });
  if (contextOnly) {
    material.blending = THREE.CustomBlending;
    material.blendEquation = material.blendEquationAlpha = THREE.MaxEquation;
    material.blendSrc = material.blendDst = material.blendSrcAlpha = material.blendDstAlpha = THREE.OneFactor;
  }
  if(hiddenOnly)material.depthFunc=THREE.GreaterDepth;
  material.userData.cssLineWidth = hiddenOnly ? .85 : width;
  return material;
}

function baseRibbonGeometry(count) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 2, 1, 3]); geometry.instanceCount = count;
  return geometry;
}

function assertEdgeRecord(buffer, record, name) {
  if (!(buffer instanceof ArrayBuffer) || !record || !Number.isInteger(record.byteOffset) || record.byteOffset < 0 || record.byteOffset % 4 || !Number.isInteger(record.segmentCount) || record.segmentCount < 0 || record.vertexCount !== record.segmentCount * 2 || record.byteOffset + record.segmentCount * 24 > buffer.byteLength) throw new Error(`Invalid prepared crease data: ${name}`);
}

/** Batched mesh-local data: no geometry transforms, adjacency or re-tessellation at frame time. */
async function prepareBatches(meshes, edgeMetadata, edgeBuffer, silhouetteMetadata, silhouetteBuffer, { signal, onProgress }) {
  if (silhouetteMetadata?.contours?.format !== 'uint32-oct16-le' || silhouetteMetadata.contours.bytesPerSegment !== 16) throw new Error('Unsupported prepared contour format.');
  if (edgeMetadata?.source?.sha256 && silhouetteMetadata?.source?.sha256 && edgeMetadata.source.sha256 !== silhouetteMetadata.source.sha256) throw new Error('Crease and contour packages describe different source assets.');
  let vertices = 0, indices = 0, creases = 0, contours = 0;
  const names = new Set();
  for (const mesh of meshes) {
    if (!mesh.name || names.has(mesh.name) || mesh.isSkinnedMesh || mesh.geometry.morphAttributes.position?.length) throw new Error('Batched linework requires uniquely named rigid parts.');
    names.add(mesh.name);
    const positions = mesh.geometry.getAttribute('position');
    if (!positions || positions.itemSize !== 3) throw new Error(`Missing part positions: ${mesh.name}`);
    const record = edgeMetadata?.meshes?.[mesh.name]; assertEdgeRecord(edgeBuffer, record, mesh.name);
    const contour = silhouetteMetadata?.meshes?.[mesh.name]; contourRecord(silhouetteBuffer, contour);
    vertices += positions.count; indices += mesh.geometry.index?.count || positions.count;
    creases += record.segmentCount; contours += contour.segmentCount;
  }
  abortIfNeeded(signal);
  const surfacePositions = new Float32Array(vertices * 3), surfaceParts = new Float32Array(vertices), surfaceIndices = new Uint32Array(indices);
  const creaseStart = new Float32Array(creases * 3), creaseEnd = new Float32Array(creases * 3), creaseParts = new Float32Array(creases);
  const contourStart = new Float32Array(contours * 3), contourEnd = new Float32Array(contours * 3), normalA = new Int16Array(contours * 2), normalB = new Int16Array(contours * 2), contourParts = new Float32Array(contours);
  let vertexOffset = 0, indexOffset = 0, creaseOffset = 0, contourOffset = 0, lastYield = performance.now();
  const pauseIfNeeded = async () => {
    if (performance.now() - lastYield > 5) { await yieldToBrowser(); abortIfNeeded(signal); lastYield = performance.now(); }
  };
  for (let part = 0; part < meshes.length; part++) {
    abortIfNeeded(signal);
    const mesh = meshes[part], positions = mesh.geometry.getAttribute('position'), index = mesh.geometry.index;
    for (let i = 0; i < positions.count; i++) {
      const target = (vertexOffset + i) * 3;
      surfacePositions[target] = positions.getX(i); surfacePositions[target + 1] = positions.getY(i); surfacePositions[target + 2] = positions.getZ(i);
      if (i > 0 && i % 8192 === 0) await pauseIfNeeded();
    }
    surfaceParts.fill(part, vertexOffset, vertexOffset + positions.count);
    const count = index?.count || positions.count;
    for (let i = 0; i < count; i++) {
      surfaceIndices[indexOffset + i] = vertexOffset + (index ? index.getX(i) : i);
      if (i > 0 && i % 16384 === 0) await pauseIfNeeded();
    }
    const edge = edgeMetadata.meshes[mesh.name], source = new Float32Array(edgeBuffer, edge.byteOffset, edge.segmentCount * 6);
    for (let i = 0; i < edge.segmentCount; i++) {
      creaseStart.set(source.subarray(i * 6, i * 6 + 3), (creaseOffset + i) * 3);
      creaseEnd.set(source.subarray(i * 6 + 3, i * 6 + 6), (creaseOffset + i) * 3);
      if (i > 0 && i % 8192 === 0) await pauseIfNeeded();
    }
    creaseParts.fill(part, creaseOffset, creaseOffset + edge.segmentCount);
    const record = silhouetteMetadata.meshes[mesh.name], segments = contourRecord(silhouetteBuffer, record);
    for (let i = 0; i < record.segmentCount; i++) {
      const sourceOffset = i * 4, target = (contourOffset + i) * 3;
      const first = segments.indices[sourceOffset], second = segments.indices[sourceOffset + 1];
      if (first >= positions.count || second >= positions.count) throw new Error(`Contour vertex exceeds source geometry: ${mesh.name}`);
      contourStart[target] = positions.getX(first); contourStart[target + 1] = positions.getY(first); contourStart[target + 2] = positions.getZ(first);
      contourEnd[target] = positions.getX(second); contourEnd[target + 1] = positions.getY(second); contourEnd[target + 2] = positions.getZ(second);
      normalA.set(segments.normals.subarray(i * 8 + 4, i * 8 + 6), (contourOffset + i) * 2);
      normalB.set(segments.normals.subarray(i * 8 + 6, i * 8 + 8), (contourOffset + i) * 2);
      if (i > 0 && i % 8192 === 0) await pauseIfNeeded();
    }
    contourParts.fill(part, contourOffset, contourOffset + record.segmentCount);
    vertexOffset += positions.count; indexOffset += count; creaseOffset += edge.segmentCount; contourOffset += record.segmentCount;
    if (performance.now() - lastYield > 5 || part === meshes.length - 1) {
      onProgress?.({ phase: 'Preparing linework', completed: part + 1, total: meshes.length, progress: (part + 1) / meshes.length });
      await yieldToBrowser(); abortIfNeeded(signal); lastYield = performance.now();
    }
  }
  const surface = new THREE.BufferGeometry();
  surface.setAttribute('position', new THREE.BufferAttribute(surfacePositions, 3)); surface.setAttribute('partIndex', new THREE.BufferAttribute(surfaceParts, 1));
  surface.setIndex(new THREE.BufferAttribute(surfaceIndices, 1));
  const crease = baseRibbonGeometry(creases), contour = baseRibbonGeometry(contours);
  for (const [name, array, size] of [['segmentStart', creaseStart, 3], ['segmentEnd', creaseEnd, 3], ['partIndex', creaseParts, 1]]) crease.setAttribute(name, new THREE.InstancedBufferAttribute(array, size));
  for (const [name, array, size] of [['segmentStart', contourStart, 3], ['segmentEnd', contourEnd, 3], ['edgeNormalA', normalA, 2], ['edgeNormalB', normalB, 2], ['partIndex', contourParts, 1]]) contour.setAttribute(name, new THREE.InstancedBufferAttribute(array, size, array instanceof Int16Array));
  const lineBytes = [creaseStart, creaseEnd, creaseParts, contourStart, contourEnd, normalA, normalB, contourParts].reduce((sum, array) => sum + array.byteLength, 0);
  return { surface, crease, contour, stats: { edgeSegments: creases, silhouetteSegments: contours, lineBytes, surfaceBytes: surfacePositions.byteLength + surfaceParts.byteLength + surfaceIndices.byteLength, lineBatchCount: 2, surfaceTriangleCount: indices / 3 } };
}

class AssemblyLineworkPass extends Pass {
  constructor(depthScene, flatScene, lineScene, camera, contextScene, hiddenScene) {
    super(); this.depthScene = depthScene; this.flatScene = flatScene; this.lineScene = lineScene; this.contextScene = contextScene; this.camera = camera;this.hiddenScene=hiddenScene;this.drawHidden=false;
    this.needsSwap = false; this.enabled = false; this.drawFlat = false; this.drawContext = false;
    this.background = new THREE.Color().setHex(0x1b1b1b, THREE.LinearSRGBColorSpace);
    this.previousColor = new THREE.Color();
  }
  render(renderer, writeBuffer, readBuffer) {
    const target = renderer.getRenderTarget(), autoClear = renderer.autoClear, alpha = renderer.getClearAlpha();
    renderer.getClearColor(this.previousColor); renderer.autoClear = false;
    try {
      renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
      renderer.setClearColor(this.background, 1); renderer.clear(true, true, false);
      renderer.render(this.depthScene, this.camera);
      if (this.drawContext) renderer.render(this.contextScene, this.camera);
      if (this.drawHidden) renderer.render(this.hiddenScene,this.camera);
      if (this.drawFlat) renderer.render(this.flatScene, this.camera);
      renderer.render(this.lineScene, this.camera);
    } finally {
      renderer.autoClear = autoClear; renderer.setClearColor(this.previousColor, alpha); renderer.setRenderTarget(target);
    }
  }
}

/**
 * Prepare once, then call sync only immediately before a dirty frame. All mesh names
 * are source identities. Parent context has no depth writes and cannot hide active parts.
 * No authored geometry/hierarchy/material or original animation track is modified.
 */
export async function createAssemblyLinework({ meshes, edgeMetadata, edgeBuffer, silhouetteMetadata, silhouetteBuffer, camera, signal, onProgress } = {}) {
  if (!Array.isArray(meshes) || !meshes.length || !camera) throw new Error('Linework requires rigid meshes and a camera.');
  abortIfNeeded(signal);
  const start = performance.now(), prepared = await prepareBatches(meshes, edgeMetadata, edgeBuffer, silhouetteMetadata, silhouetteBuffer, { signal, onProgress });
  const palette = new PartTransformPalette(meshes), accent = new THREE.Color().setHex(0xff6840, THREE.LinearSRGBColorSpace);
  const depthMaterial = surfaceMaterial(palette, false, accent), flatMaterial = surfaceMaterial(palette, true, accent);
  const creaseMaterial = ribbonMaterial(palette, false, accent), contourMaterial = ribbonMaterial(palette, true, accent);
  const contextMaterial = ribbonMaterial(palette, true, accent, true);
  const hiddenMaterial=ribbonMaterial(palette,false,accent,false,true);
  const depthScene = new THREE.Scene(), flatScene = new THREE.Scene(), lineScene = new THREE.Scene(), contextScene = new THREE.Scene();
  const depth = new THREE.Mesh(prepared.surface, depthMaterial), flat = new THREE.Mesh(prepared.surface, flatMaterial);
  const crease = new THREE.Mesh(prepared.crease, creaseMaterial), contour = new THREE.Mesh(prepared.contour, contourMaterial);
  const contextContour = new THREE.Mesh(prepared.contour, contextMaterial);
  const hiddenScene=new THREE.Scene(),hiddenLines=new THREE.Mesh(prepared.crease,hiddenMaterial);hiddenScene.add(hiddenLines);
  // Batches carry a moving palette, so a static model-space bounding sphere would
  // incorrectly cull exploded/operating components. Camera fitting belongs to scene.
  for (const mesh of [depth, flat, crease, contour, contextContour, hiddenLines]) { mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; }
  crease.renderOrder = 1; contour.renderOrder = 2;
  depthScene.add(depth); flatScene.add(flat); lineScene.add(crease, contour); contextScene.add(contextContour);
  const pass = new AssemblyLineworkPass(depthScene, flatScene, lineScene, camera, contextScene, hiddenScene);
  const stats = { ...prepared.stats, partCount: meshes.length, paletteBytes: palette.data.byteLength, paletteUploads: 0, flatPartCount: 0, prepareMs: performance.now() - start };
  let disposed = false, options={...DISPLAY_DEFAULTS}, viewport=[1,1,1];
  const updateStrokes=()=>{
    const [width,height,pixelRatio]=viewport, scale=(width<=480?.75:1)*LINE_WEIGHTS[options.lineWeight];
    for(const material of [creaseMaterial,contourMaterial,contextMaterial,hiddenMaterial]) {
      material.uniforms.resolution.value.set(Math.max(1,width*pixelRatio),Math.max(1,height*pixelRatio));
      material.uniforms.lineWidth.value=material.userData.cssLineWidth*scale*pixelRatio;
      material.uniforms.pixelRatio.value=pixelRatio;
    }
  };
  return {
    pass, stats,
    sync(state) {
      if (disposed) return;
      if (state?.accent) accent.setHex(parseInt(state.accent.replace('#', ''), 16), THREE.LinearSRGBColorSpace);
      const next={...DISPLAY_DEFAULTS,...state?.displayOptions};
      if(next.lineWeight!==options.lineWeight){options=next;updateStrokes();}else options=next;
      crease.visible=options.featureEdges;
      pass.drawHidden=options.hiddenEdges&&Boolean(state?.highlighted?.size);
      Object.assign(stats, palette.sync(state)); pass.drawFlat = stats.flatPartCount > 0;
      pass.drawContext = stats.contextPartCount > 0;
      stats.lineBatchCount = 1 + (crease.visible?1:0) + (pass.drawContext ? 1 : 0) + (pass.drawHidden?1:0);
    },
    resize(width, height, pixelRatio = 1) {
      viewport=[width,height,pixelRatio];updateStrokes();
    },
    dispose() {
      if (disposed) return; disposed = true; pass.enabled = false;
      for (const geometry of [prepared.surface, prepared.crease, prepared.contour]) geometry.dispose();
      for (const material of [depthMaterial, flatMaterial, creaseMaterial, contourMaterial, contextMaterial, hiddenMaterial]) material.dispose();
      palette.dispose(); depthScene.clear(); flatScene.clear(); lineScene.clear(); contextScene.clear();hiddenScene.clear();
    }
  };
}
