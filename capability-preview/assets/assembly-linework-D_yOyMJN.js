import{e as ge,T as we,X as ve,N as xe,Y as ye,C as q,k as te,S as j,a as H,i as ae,Z as de,_ as be,z as Se,x as Ce,K as Q,$ as re,D as ue,j as ke,a0 as Ae,a1 as Pe,a2 as We,g as Te,a3 as Me,y as Ee}from"./three-XpHUcGhX.js";import{a as ne,g as Fe,f as ee,i as Ie,L as Le}from"./model-validation-BxLE77IU.js";import"./preload-helper-PPVm8Dsz.js";import"./model-catalog-BJ-SBjKk.js";import"./catalog-C4NcA1Aj.js";const Ne=16;function oe(a,e){if(!(a instanceof ArrayBuffer)||!e||!Number.isInteger(e.byteOffset)||e.byteOffset<0||e.byteOffset%4||!Number.isInteger(e.segmentCount)||e.segmentCount<0)throw new Error("Invalid contour buffer record.");const h=e.segmentCount*Ne;if(e.byteOffset+h>a.byteLength)throw new Error("Contour record exceeds its asset.");return{indices:new Uint32Array(a,e.byteOffset,e.segmentCount*4),normals:new Int16Array(a,e.byteOffset,e.segmentCount*8),count:e.segmentCount}}const ie=Object.freeze({crease:1.05,contour:1.8}),me=8,se=me*4,V=.75,ce=()=>new Promise(a=>setTimeout(a,0)),X=a=>{if(a?.aborted)throw a.reason||new DOMException("Line preparation interrupted.","AbortError")};class Re{constructor(e){this.meshes=e,this.data=new Float32Array(Math.max(1,e.length)*se),this.texture=new ge(this.data,me,Math.max(1,e.length),we,ve),this.texture.minFilter=this.texture.magFilter=xe,this.texture.generateMipmaps=!1,this.texture.needsUpdate=!0,this.normal=new ye,this.uploads=0}sync({active:e=new Set,context:h=new Set,highlighted:m=new Set,hovered:x=new Set,filled:w=new Set,renderStyle:c="linework",perPartAlpha:N,worldMatricesUpdated:_=!1}={}){let l=!1,f=0,S=0,W=0;const y=(g,i)=>{const s=Math.fround(i);this.data[g]!==s&&(this.data[g]=s,l=!0)};for(let g=0;g<this.meshes.length;g++){const i=this.meshes[g],s=g*se;_||i.updateWorldMatrix(!0,!1);const C=i.matrixWorld.elements;let A=!1;for(let d=0;d<16;d++){if(!Number.isFinite(C[d]))throw new Error(`Invalid linework transform: ${i.name}`);this.data[s+d]!==Math.fround(C[d])&&(A=!0),y(s+d,C[d])}if(A){this.normal.getNormalMatrix(i.matrixWorld);for(let d=0;d<3;d++)for(let b=0;b<3;b++)y(s+16+d*4+b,this.normal.elements[d*3+b])}const p=e.has(i.name),E=!p&&h.has(i.name),F=N?.get(i.name),I=i.visible&&(p||E)?Math.max(0,Math.min(1,Number.isFinite(F)?F:p?1:.06)):0,T=c==="flat"&&p&&w.has(i.name)&&I>.001;y(s+19,p&&x.has(i.name)?1:0),y(s+28,I),y(s+29,p?1:0),y(s+30,p&&m.has(i.name)?1:0),y(s+31,T?1:0),I>.001&&(p?S++:E&&W++),T&&f++}return l&&(this.texture.needsUpdate=!0,this.uploads++),{dirty:l,flatPartCount:f,activePartCount:S,contextPartCount:W,paletteUploads:this.uploads}}dispose(){this.texture.dispose()}}const pe=`
  uniform sampler2D partPalette;
  uniform float partRows;
  attribute float partIndex;
  vec4 partTexel(float column) { return texture2D(partPalette, vec2((column+0.5)/8.0, (partIndex+0.5)/partRows)); }
  mat4 partMatrix() { return mat4(partTexel(0.0), partTexel(1.0), partTexel(2.0), partTexel(3.0)); }
  mat3 partNormalMatrix() { return mat3(partTexel(4.0).xyz, partTexel(5.0).xyz, partTexel(6.0).xyz); }
`;function he(a){return{partPalette:{value:a.texture},partRows:{value:Math.max(1,a.meshes.length)}}}function le(a,e,h){return new ae({uniforms:{...he(a),accent:{value:h}},vertexShader:`${pe}
      varying vec4 partState;
      void main() {
        partState=partTexel(7.0);
        if(partState.x<=0.001 || partState.y<0.5 ${e?"|| partState.w<0.5":""}) {
          gl_Position=vec4(2.0,2.0,2.0,1.0); return;
        }
        gl_Position=projectionMatrix*viewMatrix*partMatrix()*vec4(position,1.0);
      }`,fragmentShader:`uniform vec3 accent; varying vec4 partState;
      void main() {
        if(partState.x<=0.001 || partState.y<0.5 ${e?"|| partState.w<0.5":""}) discard;
        gl_FragColor=vec4(accent, ${e?"partState.x":"1.0"});
      }`,colorWrite:e,depthWrite:!e,depthTest:!0,transparent:e,side:ue,forceSinglePass:!0,toneMapped:!1,polygonOffset:!0,polygonOffsetFactor:1,polygonOffsetUnits:1})}function J(a,e,h,m=!1,x=!1){const w=e?ie.contour:ie.crease,c=new ae({uniforms:{...he(a),accent:{value:h},resolution:{value:new ke(1,1)},lineWidth:{value:w},pixelRatio:{value:1},ink:{value:new q},background:{value:new q},keyline:{value:new q}},vertexShader:`${pe}
      attribute vec3 segmentStart;
      attribute vec3 segmentEnd;
      ${e?`attribute vec2 edgeNormalA; attribute vec2 edgeNormalB;
        vec3 octNormal(vec2 encoded) {
          vec3 normal=vec3(encoded,1.0-abs(encoded.x)-abs(encoded.y));
          if(normal.z<0.0) normal.xy=(1.0-abs(normal.yx))*vec2(normal.x>=0.0?1.0:-1.0,normal.y>=0.0?1.0:-1.0);
          return normalize(normal);
        }`:""}
      uniform vec2 resolution;
      uniform float lineWidth;
      uniform float pixelRatio;
      varying vec4 partState;
      varying vec2 strokePointTimesW;
      varying float strokeW;
      varying float strokeLength;
      varying float hoverState;
      varying float effectiveWidth;
      void main() {
        partState=partTexel(7.0);hoverState=partTexel(4.0).w;
        strokePointTimesW=vec2(1000.0); strokeW=1.0; strokeLength=0.0;
        // Parent context uses silhouettes only. Dense hidden crease bundles can
        // otherwise accumulate into bright spots even at a low per-part opacity.
        if(partState.x<=0.001 || partState.y${m?">":"<"}0.5) { gl_Position=vec4(2.0,2.0,2.0,1.0); return; }
        ${x?"if(partState.z<0.5) { gl_Position=vec4(2.0,2.0,2.0,1.0); return; }":""}
        mat4 world=partMatrix();
        mat4 modelView=viewMatrix*world;
        ${e?`
          vec3 viewPoint=(modelView*vec4((segmentStart+segmentEnd)*0.5,1.0)).xyz;
          vec3 towardCamera=normalize(-viewPoint);
          mat3 viewNormal=mat3(viewMatrix)*partNormalMatrix();
          float first=dot(normalize(viewNormal*octNormal(edgeNormalA)),towardCamera);
          float second=dot(normalize(viewNormal*octNormal(edgeNormalB)),towardCamera);
          if(first*second>0.0) { gl_Position=vec4(2.0,2.0,2.0,1.0); return; }
        `:""}
        vec4 start=projectionMatrix*modelView*vec4(segmentStart,1.0);
        vec4 end=projectionMatrix*modelView*vec4(segmentEnd,1.0);
        if(start.w<=0.0001 || end.w<=0.0001) { gl_Position=vec4(2.0,2.0,2.0,1.0); return; }
        vec2 delta=(end.xy/end.w-start.xy/start.w)*resolution*0.5;
        float lengthPixels=length(delta);
        vec2 along=lengthPixels>0.0001?delta/lengthPixels:vec2(1.0,0.0);
        vec2 across=vec2(-along.y,along.x);
        effectiveWidth=lineWidth*(partState.z>0.5?1.30:1.0);
        float backing=(partState.z>0.5||hoverState>0.5)?1.2*pixelRatio:0.0;
        float halfWidth=(effectiveWidth+backing+${V})*0.5;
        vec2 offset=across*position.x*halfWidth+along*(position.y*2.0-1.0)*halfWidth;
        vec4 projected=mix(start,end,position.y);
        projected.xy+=offset*2.0/resolution*projected.w;
        gl_Position=projected;
        // Recover screen-linear analytic coverage despite perspective interpolation.
        strokePointTimesW=vec2(position.x*halfWidth,position.y*lengthPixels+(position.y*2.0-1.0)*halfWidth)*projected.w;
        strokeW=projected.w; strokeLength=lengthPixels;
      }`,fragmentShader:`
      uniform vec3 accent;
      uniform vec3 ink; uniform vec3 background; uniform vec3 keyline;
      uniform float lineWidth;
      uniform float pixelRatio;
      varying vec4 partState;
      varying vec2 strokePointTimesW;
      varying float strokeW;
      varying float strokeLength;
      varying float hoverState;
      varying float effectiveWidth;
      void main() {
        if(partState.x<=0.001 || partState.y${m?">":"<"}0.5) discard;
        vec2 point=strokePointTimesW/strokeW;
        float beyond=max(0.0,max(-point.y,point.y-strokeLength));
        float distanceToStroke=length(vec2(point.x,beyond));
        float coverage=1.0-smoothstep(max(0.0,effectiveWidth*0.5-${V*.5}),effectiveWidth*0.5+${V*.5},distanceToStroke);
        bool emphasized=partState.z>0.5||hoverState>0.5;
        float backingWidth=effectiveWidth+(emphasized?1.2*pixelRatio:0.0);
        float backing=1.0-smoothstep(max(0.0,backingWidth*0.5-${V*.5}),backingWidth*0.5+${V*.5},distanceToStroke);
        if(backing<=0.0) discard;
        vec3 color=ink;
        if(emphasized) color=accent;
        // Flat selected surfaces retain a clean neutral boundary around their fill.
        if(partState.w>0.5) color=ink;
        ${x?"if(partState.z<0.5 || mod(point.y/pixelRatio,8.0)>4.0) discard; coverage*=0.42; backing*=0.42;":""}
        ${m?`
          // MAX on dark / MIN on light caps overlap at one faint context stroke.
          gl_FragColor=vec4(mix(background,color,partState.x*coverage),1.0);
        `:`
          vec3 stroke=emphasized?mix(keyline,color,coverage/max(backing,0.001)):color;
          gl_FragColor=vec4(stroke,partState.x*backing);
        `}

      }`,transparent:!0,depthTest:!0,depthWrite:!1,side:ue,forceSinglePass:!0,toneMapped:!1});return m&&(c.blending=Ae,c.blendEquation=c.blendEquationAlpha=de,c.blendSrc=c.blendDst=c.blendSrcAlpha=c.blendDstAlpha=Pe),x&&(c.depthFunc=We),c.userData.cssLineWidth=x?.85:w,c}function fe(a){const e=new Me;return e.setAttribute("position",new Ee([-1,0,0,1,0,0,-1,1,0,1,1,0],3)),e.setIndex([0,1,2,2,1,3]),e.instanceCount=a,e}function Be(a,e,h){if(!(a instanceof ArrayBuffer)||!e||!Number.isInteger(e.byteOffset)||e.byteOffset<0||e.byteOffset%4||!Number.isInteger(e.segmentCount)||e.segmentCount<0||e.vertexCount!==e.segmentCount*2||e.byteOffset+e.segmentCount*24>a.byteLength)throw new Error(`Invalid prepared crease data: ${h}`)}async function Oe(a,e,h,m,x,{signal:w,onProgress:c}){if(m?.contours?.format!=="uint32-oct16-le"||m.contours.bytesPerSegment!==16)throw new Error("Unsupported prepared contour format.");if(e?.source?.sha256&&m?.source?.sha256&&e.source.sha256!==m.source.sha256)throw new Error("Crease and contour packages describe different source assets.");let N=0,_=0,l=0,f=0;const S=new Set;for(const r of a){if(!r.name||S.has(r.name)||r.isSkinnedMesh||r.geometry.morphAttributes.position?.length)throw new Error("Batched linework requires uniquely named rigid parts.");S.add(r.name);const u=r.geometry.getAttribute("position");if(!u||u.itemSize!==3)throw new Error(`Missing part positions: ${r.name}`);const n=e?.meshes?.[r.name];Be(h,n,r.name);const B=m?.meshes?.[r.name];oe(x,B),N+=u.count,_+=r.geometry.index?.count||u.count,l+=n.segmentCount,f+=B.segmentCount}X(w);const W=new Float32Array(N*3),y=new Float32Array(N),g=new Uint32Array(_),i=new Float32Array(l*3),s=new Float32Array(l*3),C=new Float32Array(l),A=new Float32Array(f*3),p=new Float32Array(f*3),E=new Int16Array(f*2),F=new Int16Array(f*2),I=new Float32Array(f);let T=0,d=0,b=0,R=0,O=performance.now();const $=async()=>{performance.now()-O>5&&(await ce(),X(w),O=performance.now())};for(let r=0;r<a.length;r++){X(w);const u=a[r],n=u.geometry.getAttribute("position"),B=u.geometry.index;for(let t=0;t<n.count;t++){const D=(T+t)*3;W[D]=n.getX(t),W[D+1]=n.getY(t),W[D+2]=n.getZ(t),t>0&&t%8192===0&&await $()}y.fill(r,T,T+n.count);const Y=B?.count||n.count;for(let t=0;t<Y;t++)g[d+t]=T+(B?B.getX(t):t),t>0&&t%16384===0&&await $();const o=e.meshes[u.name],L=new Float32Array(h,o.byteOffset,o.segmentCount*6);for(let t=0;t<o.segmentCount;t++)i.set(L.subarray(t*6,t*6+3),(b+t)*3),s.set(L.subarray(t*6+3,t*6+6),(b+t)*3),t>0&&t%8192===0&&await $();C.fill(r,b,b+o.segmentCount);const v=m.meshes[u.name],P=oe(x,v);for(let t=0;t<v.segmentCount;t++){const D=t*4,U=(R+t)*3,Z=P.indices[D],K=P.indices[D+1];if(Z>=n.count||K>=n.count)throw new Error(`Contour vertex exceeds source geometry: ${u.name}`);A[U]=n.getX(Z),A[U+1]=n.getY(Z),A[U+2]=n.getZ(Z),p[U]=n.getX(K),p[U+1]=n.getY(K),p[U+2]=n.getZ(K),E.set(P.normals.subarray(t*8+4,t*8+6),(R+t)*2),F.set(P.normals.subarray(t*8+6,t*8+8),(R+t)*2),t>0&&t%8192===0&&await $()}I.fill(r,R,R+v.segmentCount),T+=n.count,d+=Y,b+=o.segmentCount,R+=v.segmentCount,(performance.now()-O>5||r===a.length-1)&&(c?.({phase:"Preparing linework",completed:r+1,total:a.length,progress:(r+1)/a.length}),await ce(),X(w),O=performance.now())}const z=new Ce;z.setAttribute("position",new Q(W,3)),z.setAttribute("partIndex",new Q(y,1)),z.setIndex(new Q(g,1));const G=fe(l),M=fe(f);for(const[r,u,n]of[["segmentStart",i,3],["segmentEnd",s,3],["partIndex",C,1]])G.setAttribute(r,new re(u,n));for(const[r,u,n]of[["segmentStart",A,3],["segmentEnd",p,3],["edgeNormalA",E,2],["edgeNormalB",F,2],["partIndex",I,1]])M.setAttribute(r,new re(u,n,u instanceof Int16Array));const k=[i,s,C,A,p,E,F,I].reduce((r,u)=>r+u.byteLength,0);return{surface:z,crease:G,contour:M,stats:{edgeSegments:l,silhouetteSegments:f,lineBytes:k,surfaceBytes:W.byteLength+y.byteLength+g.byteLength,lineBatchCount:2,surfaceTriangleCount:_/3}}}class ze extends Te{constructor(e,h,m,x,w,c,N){super(),this.gridScene=N,this.drawGrid=!1,this.depthScene=e,this.flatScene=h,this.lineScene=m,this.contextScene=w,this.camera=x,this.hiddenScene=c,this.drawHidden=!1,this.needsSwap=!1,this.enabled=!1,this.drawFlat=!1,this.drawContext=!1,this.background=new q().setHex(1776411,te),this.previousColor=new q}render(e,h,m){const x=e.getRenderTarget(),w=e.autoClear,c=e.getClearAlpha();e.getClearColor(this.previousColor),e.autoClear=!1;try{e.setRenderTarget(this.renderToScreen?null:m),e.setClearColor(this.background,1),e.clear(!0,!0,!1),e.render(this.depthScene,this.camera),this.drawGrid&&e.render(this.gridScene,this.camera),this.drawContext&&e.render(this.contextScene,this.camera),this.drawHidden&&e.render(this.hiddenScene,this.camera),this.drawFlat&&e.render(this.flatScene,this.camera),e.render(this.lineScene,this.camera)}finally{e.autoClear=w,e.setClearColor(this.previousColor,c),e.setRenderTarget(x)}}}async function je({meshes:a,edgeMetadata:e,edgeBuffer:h,silhouetteMetadata:m,silhouetteBuffer:x,camera:w,signal:c,onProgress:N}={}){if(!Array.isArray(a)||!a.length||!w)throw new Error("Linework requires rigid meshes and a camera.");X(c);const _=performance.now(),l=await Oe(a,e,h,m,x,{signal:c,onProgress:N}),f=new Re(a),S=new q().setHex(16738368,te),W=le(f,!1,S),y=le(f,!0,S),g=J(f,!1,S),i=J(f,!0,S),s=J(f,!0,S,!0),C=J(f,!1,S,!1,!0),A=new j,p=new j,E=new j,F=new j,I=new H(l.surface,W),T=new H(l.surface,y),d=new H(l.crease,g),b=new H(l.contour,i),R=new H(l.contour,s),O=new j,$=new H(l.crease,C);O.add($);for(const o of[I,T,d,b,R,$])o.frustumCulled=!1,o.matrixAutoUpdate=!1;d.renderOrder=1,b.renderOrder=2,A.add(I),p.add(T),E.add(d,b),F.add(R);const z=new j,G=new ae({transparent:!0,depthTest:!0,depthWrite:!1,toneMapped:!1,vertexColors:!0,uniforms:{opacity:{value:.3}},vertexShader:"varying vec3 gridColor; void main(){gridColor=color;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",fragmentShader:"varying vec3 gridColor; uniform float opacity; void main(){vec3 c=mix(12.92*gridColor,1.055*pow(gridColor,vec3(1.0/2.4))-.055,step(vec3(.0031308),gridColor));gl_FragColor=vec4(c,opacity);}"});let M=null;const k=new ze(A,p,E,w,F,O,z),r={...l.stats,partCount:a.length,paletteBytes:f.data.byteLength,paletteUploads:0,flatPartCount:0,prepareMs:performance.now()-_};let u=!1,n={...ne},B=[1,1,1];const Y=()=>{const[o,L,v]=B,P=(o<=480?.75:1)*Le[n.lineWeight];for(const t of[g,i,s,C])t.uniforms.resolution.value.set(Math.max(1,o*v),Math.max(1,L*v)),t.uniforms.lineWidth.value=t.userData.cssLineWidth*P*v,t.uniforms.pixelRatio.value=v};return{pass:k,stats:r,sync(o){if(u)return;o?.accent&&S.setHex(parseInt(o.accent.replace("#",""),16),te);const L={...ne,...o?.displayOptions};L.lineWeight!==n.lineWeight?(n=L,Y()):n=L;const v=Fe(n.appearance);k.background.setRGB(...ee(v.background));for(const P of[g,i,s,C])P.uniforms.ink.value.setRGB(...ee(P===g||P===C?v.feature:v.contour)),P.uniforms.background.value.copy(k.background),P.uniforms.keyline.value.setRGB(...ee(Ie(n.appearance,o?.accent||"#ff6840")));s.blendEquation=s.blendEquationAlpha=n.appearance==="dark"?de:be,o?.referenceGrid&&!M&&(M=new Se(o.referenceGrid.geometry,G),M.matrixAutoUpdate=!1,M.frustumCulled=!1,z.add(M)),M&&o?.referenceGrid&&(M.matrix.copy(o.referenceGrid.matrixWorld),G.uniforms.opacity.value=v.gridOpacity),k.drawGrid=!!(M&&n.grid),d.visible=n.featureEdges,k.drawHidden=n.hiddenEdges&&!!o?.highlighted?.size,Object.assign(r,f.sync(o)),k.drawFlat=r.flatPartCount>0,k.drawContext=r.contextPartCount>0,r.lineBatchCount=(k.drawGrid?1:0)+1+(d.visible?1:0)+(k.drawContext?1:0)+(k.drawHidden?1:0)},resize(o,L,v=1){B=[o,L,v],Y()},dispose(){if(!u){u=!0,k.enabled=!1;for(const o of[l.surface,l.crease,l.contour])o.dispose();for(const o of[W,y,g,i,s,C])o.dispose();G.dispose(),z.clear(),f.dispose(),A.clear(),p.clear(),E.clear(),F.clear(),O.clear()}}}}export{ie as ASSEMBLY_LINE_WIDTHS,Re as PartTransformPalette,je as createAssemblyLinework};
