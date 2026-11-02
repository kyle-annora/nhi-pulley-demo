import{e as pe,y as he,z as ge,I as we,J as xe,C as Q,n as ee,S as H,a as j,s as ve,x as J,K as te,T as ce,D as fe,m as ye,U as Se,X as be,Y as Ce,Z as Ae,_ as Pe,$ as Te,t as Ee}from"./three-DCCeR09g.js";import{D as ae,L as Me}from"./index-B74optKL.js";const We=16;function re(r,e){if(!(r instanceof ArrayBuffer)||!e||!Number.isInteger(e.byteOffset)||e.byteOffset<0||e.byteOffset%4||!Number.isInteger(e.segmentCount)||e.segmentCount<0)throw new Error("Invalid contour buffer record.");const p=e.segmentCount*We;if(e.byteOffset+p>r.byteLength)throw new Error("Contour record exceeds its asset.");return{indices:new Uint32Array(r,e.byteOffset,e.segmentCount*4),normals:new Int16Array(r,e.byteOffset,e.segmentCount*8),count:e.segmentCount}}const ne=Object.freeze({crease:1.05,contour:1.8}),ue=8,oe=ue*4,K=.75,se=()=>new Promise(r=>setTimeout(r,0)),G=r=>{if(r?.aborted)throw r.reason||new DOMException("Line preparation interrupted.","AbortError")};class Ie{constructor(e){this.meshes=e,this.data=new Float32Array(Math.max(1,e.length)*oe),this.texture=new pe(this.data,ue,Math.max(1,e.length),he,ge),this.texture.minFilter=this.texture.magFilter=we,this.texture.generateMipmaps=!1,this.texture.needsUpdate=!0,this.normal=new xe,this.uploads=0}sync({active:e=new Set,context:p=new Set,highlighted:u=new Set,hovered:g=new Set,filled:h=new Set,renderStyle:o="linework",perPartAlpha:O,worldMatricesUpdated:R=!1}={}){let s=!1,i=0,S=0,A=0;const x=(w,l)=>{const d=Math.fround(l);this.data[w]!==d&&(this.data[w]=d,s=!0)};for(let w=0;w<this.meshes.length;w++){const l=this.meshes[w],d=w*oe;R||l.updateWorldMatrix(!0,!1);const P=l.matrixWorld.elements;let b=!1;for(let c=0;c<16;c++){if(!Number.isFinite(P[c]))throw new Error(`Invalid linework transform: ${l.name}`);this.data[d+c]!==Math.fround(P[c])&&(b=!0),x(d+c,P[c])}if(b){this.normal.getNormalMatrix(l.matrixWorld);for(let c=0;c<3;c++)for(let v=0;v<3;v++)x(d+16+c*4+v,this.normal.elements[c*3+v])}const m=e.has(l.name),E=!m&&p.has(l.name),M=O?.get(l.name),W=l.visible&&(m||E)?Math.max(0,Math.min(1,Number.isFinite(M)?M:m?1:.06)):0,T=o==="flat"&&m&&h.has(l.name)&&W>.001;x(d+19,m&&g.has(l.name)?1:0),x(d+28,W),x(d+29,m?1:0),x(d+30,m&&u.has(l.name)?1:0),x(d+31,T?1:0),W>.001&&(m?S++:E&&A++),T&&i++}return s&&(this.texture.needsUpdate=!0,this.uploads++),{dirty:s,flatPartCount:i,activePartCount:S,contextPartCount:A,paletteUploads:this.uploads}}dispose(){this.texture.dispose()}}const de=`
  uniform sampler2D partPalette;
  uniform float partRows;
  attribute float partIndex;
  vec4 partTexel(float column) { return texture2D(partPalette, vec2((column+0.5)/8.0, (partIndex+0.5)/partRows)); }
  mat4 partMatrix() { return mat4(partTexel(0.0), partTexel(1.0), partTexel(2.0), partTexel(3.0)); }
  mat3 partNormalMatrix() { return mat3(partTexel(4.0).xyz, partTexel(5.0).xyz, partTexel(6.0).xyz); }
`;function me(r){return{partPalette:{value:r.texture},partRows:{value:Math.max(1,r.meshes.length)}}}function ie(r,e,p){return new ce({uniforms:{...me(r),accent:{value:p}},vertexShader:`${de}
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
      }`,colorWrite:e,depthWrite:!e,depthTest:!0,transparent:e,side:fe,forceSinglePass:!0,toneMapped:!1,polygonOffset:!0,polygonOffsetFactor:1,polygonOffsetUnits:1})}function Z(r,e,p,u=!1,g=!1){const h=e?ne.contour:ne.crease,o=new ce({uniforms:{...me(r),accent:{value:p},resolution:{value:new ye(1,1)},lineWidth:{value:h},pixelRatio:{value:1}},vertexShader:`${de}
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
      void main() {
        partState=partTexel(7.0);hoverState=partTexel(4.0).w;
        strokePointTimesW=vec2(1000.0); strokeW=1.0; strokeLength=0.0;
        // Parent context uses silhouettes only. Dense hidden crease bundles can
        // otherwise accumulate into bright spots even at a low per-part opacity.
        if(partState.x<=0.001 || partState.y${u?">":"<"}0.5) { gl_Position=vec4(2.0,2.0,2.0,1.0); return; }
        ${g?"if(partState.z<0.5) { gl_Position=vec4(2.0,2.0,2.0,1.0); return; }":""}
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
        float halfWidth=(lineWidth+${K})*0.5;
        vec2 offset=across*position.x*halfWidth+along*(position.y*2.0-1.0)*halfWidth;
        vec4 projected=mix(start,end,position.y);
        projected.xy+=offset*2.0/resolution*projected.w;
        gl_Position=projected;
        // Recover screen-linear analytic coverage despite perspective interpolation.
        strokePointTimesW=vec2(position.x*halfWidth,position.y*lengthPixels+(position.y*2.0-1.0)*halfWidth)*projected.w;
        strokeW=projected.w; strokeLength=lengthPixels;
      }`,fragmentShader:`
      uniform vec3 accent;
      uniform float lineWidth;
      uniform float pixelRatio;
      varying vec4 partState;
      varying vec2 strokePointTimesW;
      varying float strokeW;
      varying float strokeLength;
      varying float hoverState;
      void main() {
        if(partState.x<=0.001 || partState.y${u?">":"<"}0.5) discard;
        vec2 point=strokePointTimesW/strokeW;
        float beyond=max(0.0,max(-point.y,point.y-strokeLength));
        float distanceToStroke=length(vec2(point.x,beyond));
        float coverage=1.0-smoothstep(max(0.0,lineWidth*0.5-${K*.5}),lineWidth*0.5+${K*.5},distanceToStroke);
        if(coverage<=0.0) discard;
        vec3 color=${e?"vec3(229.0,232.0,235.0)":"vec3(150.0,157.0,165.0)"}/255.0;
        if(hoverState>0.5) color=vec3(1.0);
        if(partState.w>0.5) color=vec3(1.0);
        ${g?"if(partState.z<0.5 || mod(point.y/pixelRatio,8.0)>4.0) discard; coverage*=0.42;":""}
        ${u?`
          // Resolve coverage against the fixed display background before MAX
          // blending. Overlapping context never adds opacity or brightness.
          gl_FragColor=vec4(mix(vec3(27.0/255.0),color,partState.x*coverage),1.0);
        `:`
          if(partState.z>0.5 && partState.w<0.5) color=accent;
          gl_FragColor=vec4(color,partState.x*coverage);
        `}
      }`,transparent:!0,depthTest:!0,depthWrite:!1,side:fe,forceSinglePass:!0,toneMapped:!1});return u&&(o.blending=Se,o.blendEquation=o.blendEquationAlpha=be,o.blendSrc=o.blendDst=o.blendSrcAlpha=o.blendDstAlpha=Ce),g&&(o.depthFunc=Ae),o.userData.cssLineWidth=g?.85:h,o}function le(r){const e=new Te;return e.setAttribute("position",new Ee([-1,0,0,1,0,0,-1,1,0,1,1,0],3)),e.setIndex([0,1,2,2,1,3]),e.instanceCount=r,e}function ke(r,e,p){if(!(r instanceof ArrayBuffer)||!e||!Number.isInteger(e.byteOffset)||e.byteOffset<0||e.byteOffset%4||!Number.isInteger(e.segmentCount)||e.segmentCount<0||e.vertexCount!==e.segmentCount*2||e.byteOffset+e.segmentCount*24>r.byteLength)throw new Error(`Invalid prepared crease data: ${p}`)}async function Fe(r,e,p,u,g,{signal:h,onProgress:o}){if(u?.contours?.format!=="uint32-oct16-le"||u.contours.bytesPerSegment!==16)throw new Error("Unsupported prepared contour format.");if(e?.source?.sha256&&u?.source?.sha256&&e.source.sha256!==u.source.sha256)throw new Error("Crease and contour packages describe different source assets.");let O=0,R=0,s=0,i=0;const S=new Set;for(const n of r){if(!n.name||S.has(n.name)||n.isSkinnedMesh||n.geometry.morphAttributes.position?.length)throw new Error("Batched linework requires uniquely named rigid parts.");S.add(n.name);const f=n.geometry.getAttribute("position");if(!f||f.itemSize!==3)throw new Error(`Missing part positions: ${n.name}`);const t=e?.meshes?.[n.name];ke(p,t,n.name);const y=u?.meshes?.[n.name];re(g,y),O+=f.count,R+=n.geometry.index?.count||f.count,s+=t.segmentCount,i+=y.segmentCount}G(h);const A=new Float32Array(O*3),x=new Float32Array(O),w=new Uint32Array(R),l=new Float32Array(s*3),d=new Float32Array(s*3),P=new Float32Array(s),b=new Float32Array(i*3),m=new Float32Array(i*3),E=new Int16Array(i*2),M=new Int16Array(i*2),W=new Float32Array(i);let T=0,c=0,v=0,I=0,F=performance.now();const B=async()=>{performance.now()-F>5&&(await se(),G(h),F=performance.now())};for(let n=0;n<r.length;n++){G(h);const f=r[n],t=f.geometry.getAttribute("position"),y=f.geometry.index;for(let a=0;a<t.count;a++){const D=(T+a)*3;A[D]=t.getX(a),A[D+1]=t.getY(a),A[D+2]=t.getZ(a),a>0&&a%8192===0&&await B()}x.fill(n,T,T+t.count);const k=y?.count||t.count;for(let a=0;a<k;a++)w[c+a]=T+(y?y.getX(a):a),a>0&&a%16384===0&&await B();const _=e.meshes[f.name],$=new Float32Array(p,_.byteOffset,_.segmentCount*6);for(let a=0;a<_.segmentCount;a++)l.set($.subarray(a*6,a*6+3),(v+a)*3),d.set($.subarray(a*6+3,a*6+6),(v+a)*3),a>0&&a%8192===0&&await B();P.fill(n,v,v+_.segmentCount);const Y=u.meshes[f.name],q=re(g,Y);for(let a=0;a<Y.segmentCount;a++){const D=a*4,U=(I+a)*3,V=q.indices[D],X=q.indices[D+1];if(V>=t.count||X>=t.count)throw new Error(`Contour vertex exceeds source geometry: ${f.name}`);b[U]=t.getX(V),b[U+1]=t.getY(V),b[U+2]=t.getZ(V),m[U]=t.getX(X),m[U+1]=t.getY(X),m[U+2]=t.getZ(X),E.set(q.normals.subarray(a*8+4,a*8+6),(I+a)*2),M.set(q.normals.subarray(a*8+6,a*8+8),(I+a)*2),a>0&&a%8192===0&&await B()}W.fill(n,I,I+Y.segmentCount),T+=t.count,c+=k,v+=_.segmentCount,I+=Y.segmentCount,(performance.now()-F>5||n===r.length-1)&&(o?.({phase:"Preparing linework",completed:n+1,total:r.length,progress:(n+1)/r.length}),await se(),G(h),F=performance.now())}const C=new ve;C.setAttribute("position",new J(A,3)),C.setAttribute("partIndex",new J(x,1)),C.setIndex(new J(w,1));const L=le(s),z=le(i);for(const[n,f,t]of[["segmentStart",l,3],["segmentEnd",d,3],["partIndex",P,1]])L.setAttribute(n,new te(f,t));for(const[n,f,t]of[["segmentStart",b,3],["segmentEnd",m,3],["edgeNormalA",E,2],["edgeNormalB",M,2],["partIndex",W,1]])z.setAttribute(n,new te(f,t,f instanceof Int16Array));const N=[l,d,P,b,m,E,M,W].reduce((n,f)=>n+f.byteLength,0);return{surface:C,crease:L,contour:z,stats:{edgeSegments:s,silhouetteSegments:i,lineBytes:N,surfaceBytes:A.byteLength+x.byteLength+w.byteLength,lineBatchCount:2,surfaceTriangleCount:R/3}}}class Le extends Pe{constructor(e,p,u,g,h,o){super(),this.depthScene=e,this.flatScene=p,this.lineScene=u,this.contextScene=h,this.camera=g,this.hiddenScene=o,this.drawHidden=!1,this.needsSwap=!1,this.enabled=!1,this.drawFlat=!1,this.drawContext=!1,this.background=new Q().setHex(1776411,ee),this.previousColor=new Q}render(e,p,u){const g=e.getRenderTarget(),h=e.autoClear,o=e.getClearAlpha();e.getClearColor(this.previousColor),e.autoClear=!1;try{e.setRenderTarget(this.renderToScreen?null:u),e.setClearColor(this.background,1),e.clear(!0,!0,!1),e.render(this.depthScene,this.camera),this.drawContext&&e.render(this.contextScene,this.camera),this.drawHidden&&e.render(this.hiddenScene,this.camera),this.drawFlat&&e.render(this.flatScene,this.camera),e.render(this.lineScene,this.camera)}finally{e.autoClear=h,e.setClearColor(this.previousColor,o),e.setRenderTarget(g)}}}async function Re({meshes:r,edgeMetadata:e,edgeBuffer:p,silhouetteMetadata:u,silhouetteBuffer:g,camera:h,signal:o,onProgress:O}={}){if(!Array.isArray(r)||!r.length||!h)throw new Error("Linework requires rigid meshes and a camera.");G(o);const R=performance.now(),s=await Fe(r,e,p,u,g,{signal:o,onProgress:O}),i=new Ie(r),S=new Q().setHex(16738368,ee),A=ie(i,!1,S),x=ie(i,!0,S),w=Z(i,!1,S),l=Z(i,!0,S),d=Z(i,!0,S,!0),P=Z(i,!1,S,!1,!0),b=new H,m=new H,E=new H,M=new H,W=new j(s.surface,A),T=new j(s.surface,x),c=new j(s.crease,w),v=new j(s.contour,l),I=new j(s.contour,d),F=new H,B=new j(s.crease,P);F.add(B);for(const t of[W,T,c,v,I,B])t.frustumCulled=!1,t.matrixAutoUpdate=!1;c.renderOrder=1,v.renderOrder=2,b.add(W),m.add(T),E.add(c,v),M.add(I);const C=new Le(b,m,E,h,M,F),L={...s.stats,partCount:r.length,paletteBytes:i.data.byteLength,paletteUploads:0,flatPartCount:0,prepareMs:performance.now()-R};let z=!1,N={...ae},n=[1,1,1];const f=()=>{const[t,y,k]=n,_=(t<=480?.75:1)*Me[N.lineWeight];for(const $ of[w,l,d,P])$.uniforms.resolution.value.set(Math.max(1,t*k),Math.max(1,y*k)),$.uniforms.lineWidth.value=$.userData.cssLineWidth*_*k,$.uniforms.pixelRatio.value=k};return{pass:C,stats:L,sync(t){if(z)return;t?.accent&&S.setHex(parseInt(t.accent.replace("#",""),16),ee);const y={...ae,...t?.displayOptions};y.lineWeight!==N.lineWeight?(N=y,f()):N=y,c.visible=N.featureEdges,C.drawHidden=N.hiddenEdges&&!!t?.highlighted?.size,Object.assign(L,i.sync(t)),C.drawFlat=L.flatPartCount>0,C.drawContext=L.contextPartCount>0,L.lineBatchCount=1+(c.visible?1:0)+(C.drawContext?1:0)+(C.drawHidden?1:0)},resize(t,y,k=1){n=[t,y,k],f()},dispose(){if(!z){z=!0,C.enabled=!1;for(const t of[s.surface,s.crease,s.contour])t.dispose();for(const t of[A,x,w,l,d,P])t.dispose();i.dispose(),b.clear(),m.clear(),E.clear(),M.clear(),F.clear()}}}}export{ne as ASSEMBLY_LINE_WIDTHS,Ie as PartTransformPalette,Re as createAssemblyLinework};
