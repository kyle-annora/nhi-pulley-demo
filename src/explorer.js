import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

export const FOCUS={
  overview:{title:'See the part in context',text:'Drag to rotate. Scroll or use the controls to zoom. Choose a numbered detail to understand what matters for selection.',tag:'Illustrative model',position:[4.8,3.1,5.7]},
  belt:{title:'The surface the belt runs on',text:'B is the flat belt-running diameter. D is the axial width between the flanges. Keep these separate from the overall outside diameter.',tag:'B · 2-3/4″   /   D · 3/4″',position:[5,2,3.7]},
  flange:{title:'The outside edge is larger',text:'A measures across the flange edges. F-4412 has a 3-1/8″ outside diameter, while its belt-running diameter is 2-3/4″.',tag:'A · 3-1/8″',position:[.6,.6,6.7]},
  mount:{title:'Check how the pulley mounts',text:'Bore, mounting offsets, spacers and application loads need to be checked together. This reconstructed hub is illustrative; record mounting needs in the RFQ.',tag:'Mounting · Engineering review',position:[1,.6,4.5]}
};

export function drawing(p,unit='in'){
  const dim=k=>unit==='mm'?`${+(p[k]*25.4).toFixed(3)} mm`:`${p[k+'Label']}″`;
  return `<svg class="technical-drawing" viewBox="0 0 680 440" role="img" aria-label="${p.id} dimension schematic. Outside diameter ${dim('od')}; flat diameter ${dim('flat')}; width ${dim('width')}. Other geometry illustrative.">
  <defs><pattern id="hatch" width="8" height="8" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="0" y2="8" stroke="#aeb7ab" stroke-width="1"/></pattern><marker id="arr" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 8 4 0 8" fill="#46702c"/></marker></defs>
  <g fill="none" stroke="#535e52" stroke-width="1.5"><circle cx="230" cy="218" r="120"/><circle cx="230" cy="218" r="105.6" stroke-dasharray="4 4"/><circle cx="230" cy="218" r="87"/><circle cx="230" cy="218" r="30"/><circle cx="230" cy="218" r="14.4"/><path d="M470 98h12v240h-12zM540 98h12v240h-12z" fill="url(#hatch)"/><path d="M482 112h58v212h-58z" fill="#e1e7dd"/><path d="M465 201h94v34h-94z" fill="#f2f4f2"/><path d="M90 218h280M230 78v280M446 218h130" stroke="#9aa694" stroke-dasharray="7 5" stroke-width="1"/></g>
  <g fill="none" stroke="#46702c" stroke-width="1"><path d="M110 80V57M350 80V57M110 65h240"/><path d="M110 65h240" marker-start="url(#arr)" marker-end="url(#arr)"/><path d="M124 353v31M336 353v31M124 375h212" marker-start="url(#arr)" marker-end="url(#arr)"/><path d="M482 86V56M540 86V56M482 65h58" marker-start="url(#arr)" marker-end="url(#arr)"/></g>
  <g fill="#3d582f" font-family="ui-monospace,monospace" font-size="15" text-anchor="middle"><text x="230" y="46">A · ${dim('od')}</text><text x="230" y="402">B · ${dim('flat')}</text><text x="511" y="46">D · ${dim('width')}</text></g>
  <g fill="#63705f" font-family="Arial,sans-serif" font-size="11" text-anchor="middle"><text x="230" y="427">FRONT VIEW</text><text x="511" y="367">SIDE VIEW</text></g></svg>`;
}

export function mountExplorer(container,{onFocus=()=>{},onFailure=()=>{}}={}){
  let renderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});}catch{onFailure();return null;}
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  renderer.setClearColor(0xf2f4f2,0);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
  renderer.domElement.setAttribute('aria-label','Interactive illustrative F-4412 pulley. Use the focus and rotation buttons for keyboard control.');
  renderer.domElement.setAttribute('role','img');
  container.prepend(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(34,1,.05,100);
  camera.position.set(...FOCUS.overview.position);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.enablePan=false;controls.minDistance=3.4;controls.maxDistance=10;controls.maxPolarAngle=Math.PI*.95;
  const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment();const env=pmrem.fromScene(room,.04);scene.environment=env.texture;room.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff,0x7f897b,2.2));
  const key=new THREE.DirectionalLight(0xffffff,3.8);key.position.set(-3,4,6);scene.add(key);
  const rim=new THREE.DirectionalLight(0xffffff,3.1);rim.position.set(4,1,-3);scene.add(rim);
  const group=new THREE.Group();group.rotation.x=Math.PI/2;scene.add(group);
  const steel=new THREE.MeshStandardMaterial({color:0xaaaead,metalness:.88,roughness:.32});
  const beltMat=new THREE.MeshStandardMaterial({color:0x737c79,metalness:.82,roughness:.38});
  const hubMat=new THREE.MeshStandardMaterial({color:0xb9bebb,metalness:.86,roughness:.26});
  const sealMat=new THREE.MeshStandardMaterial({color:0x29302d,metalness:.3,roughness:.65});
  const meshes=[];
  function lathe(profile,mat,part){const g=new THREE.LatheGeometry(profile.map(v=>new THREE.Vector2(...v)),128);const m=new THREE.Mesh(g,mat);m.userData.part=part;group.add(m);meshes.push(m);return m;}
  // A=3.125, B=2.75, D=.75 inches. Remaining stamped contours and hub are reconstructed.
  lathe([[1.375,-.375],[1.375,.375],[1.335,.375],[1.335,-.375],[1.375,-.375]],beltMat,'belt');
  const profile=[[.24,.24],[.4,.24],[.48,.28],[1.1,.28],[1.26,.32],[1.375,.375],[1.54,.375],[1.5625,.39],[1.5625,.425],[1.54,.44],[1.375,.425],[1.25,.37],[1.1,.33],[.48,.33],[.4,.30],[.24,.30],[.24,.24]];
  lathe(profile,steel,'flange');lathe(profile.map(([r,y])=>[r,-y]).reverse(),steel,'flange');
  lathe([[.1875,-.53],[.24,-.53],[.27,-.49],[.27,.49],[.24,.53],[.1875,.53],[.1875,-.53]],hubMat,'mount');
  for(const sign of [-1,1]){
    lathe([[.27,.305*sign],[.4,.305*sign],[.4,.325*sign],[.27,.325*sign],[.27,.305*sign]],sealMat,'mount');
    const g=new THREE.TorusGeometry(1.31,.012,8,128),m=new THREE.Mesh(g,hubMat);m.rotation.x=Math.PI/2;m.position.y=.385*sign;group.add(m);
  }
  const shadowCanvas=document.createElement('canvas');shadowCanvas.width=128;shadowCanvas.height=128;const ctx=shadowCanvas.getContext('2d');const gradient=ctx.createRadialGradient(64,64,8,64,64,64);gradient.addColorStop(0,'rgba(42,57,42,.25)');gradient.addColorStop(1,'rgba(42,57,42,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
  const shadowTex=new THREE.CanvasTexture(shadowCanvas),shadow=new THREE.Mesh(new THREE.PlaneGeometry(5,4),new THREE.MeshBasicMaterial({map:shadowTex,transparent:true,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=-1.7;scene.add(shadow);
  const markers=[{key:'belt',p:new THREE.Vector3(1.36,.2,.05)},{key:'flange',p:new THREE.Vector3(-1.12,.95,.40)},{key:'mount',p:new THREE.Vector3(0,0,.54)}];
  const markerEls=markers.map((m,i)=>{const b=document.createElement('button');b.className='hotspot';b.textContent=String(i+1);b.setAttribute('aria-label',`Focus ${['belt-running surface','flanges','mounting'][i]}`);b.setAttribute('aria-pressed','false');b.type='button';b.onclick=()=>focus(m.key);container.append(b);return b;});
  let disposed=false,targetCamera=null,focused='overview',raf;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function focus(k){focused=k;targetCamera=new THREE.Vector3(...FOCUS[k].position);if(reduced){camera.position.copy(targetCamera);targetCamera=null;}controls.target.set(0,0,0);steel.emissive.set(k==='flange'?0x15220c:0x000000);beltMat.emissive.set(k==='belt'?0x22340e:0x000000);hubMat.emissive.set(k==='mount'?0x22340e:0x000000);markerEls.forEach((b,i)=>{const selected=markers[i].key===k;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));});onFocus(k);}
  const stopTween=()=>{targetCamera=null;};controls.addEventListener('start',stopTween);
  const resize=()=>{if(!container.isConnected)return;const {width,height}=container.getBoundingClientRect();camera.aspect=width/Math.max(height,1);camera.updateProjectionMatrix();renderer.setSize(width,height);};
  const observer=new ResizeObserver(resize);observer.observe(container);resize();
  function frame(){if(disposed)return;raf=requestAnimationFrame(frame);if(targetCamera){camera.position.lerp(targetCamera,.12);if(camera.position.distanceTo(targetCamera)<.005)targetCamera=null;}controls.update();renderer.render(scene,camera);
    markers.forEach((m,i)=>{const v=m.p.clone().project(camera);markerEls[i].style.left=`${(v.x*.5+.5)*100}%`;markerEls[i].style.top=`${(-v.y*.5+.5)*100}%`;markerEls[i].style.visibility=v.z<1&&Math.abs(v.x)<.93&&Math.abs(v.y)<.9?'visible':'hidden';});
  }frame();
  let pointerStart;const down=e=>{pointerStart={x:e.clientX,y:e.clientY};};
  const up=e=>{if(!pointerStart||Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)>5)return;const rect=renderer.domElement.getBoundingClientRect();const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(((e.clientX-rect.left)/rect.width)*2-1,-((e.clientY-rect.top)/rect.height)*2+1),camera);const hit=ray.intersectObjects(meshes)[0];if(hit)focus(hit.object.userData.part);};
  renderer.domElement.addEventListener('pointerdown',down);renderer.domElement.addEventListener('pointerup',up);
  const lost=e=>{e.preventDefault();onFailure();};renderer.domElement.addEventListener('webglcontextlost',lost);
  return {focus,zoom(delta){targetCamera=null;const dist=THREE.MathUtils.clamp(camera.position.length()+delta,3.4,10);camera.position.setLength(dist);},rotate(delta){targetCamera=null;camera.position.applyAxisAngle(new THREE.Vector3(0,1,0),delta);},reset(){focus('overview');},destroy(){disposed=true;cancelAnimationFrame(raf);observer.disconnect();controls.dispose();scene.traverse(o=>{o.geometry?.dispose();});[steel,beltMat,hubMat,sealMat,shadow.material].forEach(m=>m.dispose());env.dispose();pmrem.dispose();shadowTex.dispose();renderer.dispose();renderer.domElement.remove();markerEls.forEach(b=>b.remove());}};
}
