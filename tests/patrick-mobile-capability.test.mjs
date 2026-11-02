import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {MOBILE_CAPABILITY_CHANNEL as channel,capabilityURL,mobileBuyerURL,readMobileCapabilityMessage} from '../src/patrick-capability-navigation.mjs';

const base='https://kyle-annora.github.io/nhi-pulley-demo/patrick.html';
const id='ROOM-PREVIEW-12345678-1234-1234-1234-123456789012';
test('mobile preview routes preserve the repository prefix and exact saved preview identity',()=>{
  assert.equal(capabilityURL('studio',base),'https://kyle-annora.github.io/nhi-pulley-demo/capability-preview/studio/?patrickMobile=1#products');
  const url=new URL(mobileBuyerURL({id,page:'overview'},base));
  assert.equal(url.pathname,'/nhi-pulley-demo/capability-preview/product-room/');
  assert.equal(url.searchParams.get('studioPreview'),id);assert.equal(url.searchParams.get('patrickMobile'),'1');assert.equal(url.searchParams.get('model'),'kinetic-01');
  assert.equal(mobileBuyerURL({id:'https://elsewhere.test/',page:'overview'},base),null);
  assert.equal(mobileBuyerURL({id,page:'../../studio'},base),null);
});

test('parent routing accepts only the exact current frame, origin and bounded actions',()=>{
  const studioWindow={},buyerWindow={},context={origin:'https://kyle-annora.github.io',studioWindow,buyerWindow};
  const event={origin:context.origin,source:studioWindow,data:{channel,version:1,type:'buyer-preview',id,page:'overview'}};
  assert.deepEqual(readMobileCapabilityMessage(event,context),{type:'buyer-preview',id,page:'overview'});
  assert.equal(readMobileCapabilityMessage({...event,origin:'https://other.test'},context),null);
  assert.equal(readMobileCapabilityMessage({...event,source:{}},context),null);
  assert.equal(readMobileCapabilityMessage({...event,data:{...event.data,type:'publish'}},context),null);
  assert.equal(readMobileCapabilityMessage({...event,data:{...event.data,id:'../../other'}},context),null);
  assert.deepEqual(readMobileCapabilityMessage({...event,source:buyerWindow,data:{channel,version:1,type:'back-studio'}},context),{type:'back-studio'});
  assert.equal(readMobileCapabilityMessage({...event,data:{channel,version:1,type:'back-studio'}},context),null);
});

const script=readFileSync(new URL('../capability-preview/patrick-mobile-bridge.js',import.meta.url),'utf8');
function bridge({kind='studio',gated=true}={}){
  const location=new URL(`https://kyle-annora.github.io/nhi-pulley-demo/capability-preview/${kind==='studio'?'studio':'product-room'}/?${gated?'patrickMobile=1&':''}model=kinetic-01&studioPreview=${id}#${kind==='studio'?`preview?id=${id}`:'overview'}`);
  const posted=[],listeners={},documentListeners={},classes=new Set(),parent={},buttons=[];
  const frame={getAttribute:name=>name==='src'?`../product-room/?model=kinetic-01&studioPreview=${id}#overview`:null};
  const doc={head:{appendChild(){}},createElement:()=>({}),documentElement:{classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name),remove:name=>classes.delete(name)}},querySelector:selector=>selector==='iframe[title="Buyer preview of the product draft"]'?frame:null,querySelectorAll:()=>buttons,addEventListener:(type,fn)=>documentListeners[type]=fn};
  const window={location,parent,addEventListener:(type,fn)=>listeners[type]=fn};
  parent.postMessage=(data,origin)=>posted.push({data,origin});
  Object.defineProperty(window,'localStorage',{get(){throw Error('bridge must not access storage');}});
  Object.defineProperty(window,'sessionStorage',{get(){throw Error('bridge must not access storage');}});
  let inspect;
  vm.runInNewContext(script,{window,document:doc,URL,URLSearchParams,MutationObserver:class{constructor(fn){inspect=fn;}observe(){}},console});
  const message=(type,fields={},source=parent,origin=location.origin)=>listeners.message?.({source,origin,data:{channel,version:1,type,...fields}});
  return {location,posted,listeners,documentListeners,classes,parent,buttons,message,inspect:()=>inspect?.()};
}

test('query-gated adapter waits for parent configuration and never reads browser stores',()=>{
  const b=bridge();b.inspect();assert.equal(b.posted.length,0);
  b.message('configure-mobile',{enabled:true},{},b.location.origin);assert.equal(b.posted.length,0);
  b.message('configure-mobile',{enabled:true},b.parent,'https://other.test');assert.equal(b.posted.length,0);
  b.message('configure-mobile',{enabled:true});assert.equal(b.posted.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(b.posted[0])),{data:{channel,version:1,type:'buyer-preview',id,page:'overview'},origin:'https://kyle-annora.github.io'});
  assert.ok(b.classes.has('patrick-mobile-studio-preview'));b.inspect();assert.equal(b.posted.length,1);
  b.message('configure-mobile',{enabled:false});assert.equal(b.classes.size,0);
  const ungated=bridge({gated:false});assert.deepEqual(Object.keys(ungated.listeners),[]);
});

test('Studio actions invoke existing reviewed buttons and wait for actual route change',()=>{
  const b=bridge();let clicked=0;
  b.buttons.push({disabled:false,textContent:'Back to editorSaving…',querySelector:()=>({textContent:'Back to editor'}),click(){clicked++;b.location.hash='edit/product';}});
  b.message('configure-mobile',{enabled:true});b.message('back-editor');
  assert.equal(clicked,1);assert.equal(b.posted.at(-1).data.type,'studio-visible');assert.equal(b.posted.at(-1).data.page,'editor');
  b.message('review-release');assert.equal(b.posted.at(-1).data.type,'command-unavailable');
  assert.equal(clicked,1);
  b.location.hash=`preview?id=${id}`;
  b.buttons.push({disabled:false,textContent:'Review releaseChecking…',querySelector:()=>({textContent:'Review release'}),click(){clicked++;b.location.hash='release';}});
  b.message('review-release');assert.equal(clicked,2);
  assert.equal(b.posted.at(-1).data.type,'studio-visible');assert.equal(b.posted.at(-1).data.page,'release');
});

test('native customer Return to Studio is contained in the saved-preview presentation',()=>{
  const b=bridge({kind:'room'});b.message('configure-mobile',{enabled:true});
  let prevented=false,stopped=false;
  b.documentListeners.click({target:{closest:selector=>selector==='#room-version-banner a'?{getAttribute:()=> '../studio/'}:null},preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;}});
  assert.ok(prevented&&stopped);assert.equal(b.posted.at(-1).data.type,'back-studio');
  assert.equal(b.posted.at(-1).origin,b.location.origin);
});
