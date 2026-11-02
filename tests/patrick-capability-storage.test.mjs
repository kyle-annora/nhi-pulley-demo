import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const bootstrap=readFileSync(new URL('../capability-preview/storage-isolation.js',import.meta.url),'utf8');
const PREFIX='nhi-patrick-capability-v1:';
function nativeStorage(initial={}){
  const map=new Map(Object.entries(initial));
  return {getItem:key=>map.get(String(key))??null,setItem:(key,value)=>map.set(String(key),String(value)),removeItem:key=>map.delete(String(key)),clear:()=>map.clear(),key:index=>[...map.keys()][index]??null,get length(){return map.size;},map};
}
function install({blocked=false}={}){
  const local=nativeStorage({'annora.studio.products.v1':'original studio','nhi-patrick-demo-v1':'main case',[PREFIX+'seed']:'separate sample'}),session=nativeStorage({unrelated:'keep'}),calls=[],listeners={};
  const idb={open:(...args)=>calls.push(['open',...args]),deleteDatabase:name=>calls.push(['delete',name]),cmp:(a,b)=>a-b,databases:async()=>[{name:'annora.studio.drawing-assets.v1',version:1},{name:PREFIX+'drawing-assets',version:2}]};
  const window={localStorage:local,sessionStorage:session,indexedDB:idb,document:{readyState:'loading',addEventListener(){},createElement(){throw Error('not needed');}},addEventListener:(type,listener)=>{listeners[type]=listener;}};
  if(blocked)Object.defineProperty(window,'localStorage',{value:local,configurable:false});
  vm.runInNewContext(bootstrap,{window,console});return {window,local,session,calls,listeners};
}

test('preview Storage reads and writes only its prefix, including property access',()=>{
  const {window,local}=install(),store=window.localStorage;
  assert.equal(window.__NHI_CAPABILITY_STORAGE__.ready,true);
  assert.equal(store.getItem('annora.studio.products.v1'),null);
  assert.equal(store.getItem('nhi-patrick-demo-v1'),null);
  assert.equal(store.seed,'separate sample');
  store.setItem('annora.studio.products.v1','preview studio');store.customer='example';
  assert.equal(local.getItem('annora.studio.products.v1'),'original studio');
  assert.equal(local.getItem('nhi-patrick-demo-v1'),'main case');
  assert.equal(local.getItem(PREFIX+'annora.studio.products.v1'),'preview studio');
  assert.equal(store.getItem('customer'),'example');delete store.customer;
  assert.equal(store.getItem('customer'),null);
});

test('preview Storage key enumeration, length and clear preserve every unrelated record',()=>{
  const {window,local,session}=install(),store=window.localStorage;
  store.setItem('second',2);assert.equal(store.length,2);
  assert.deepEqual(Array.from({length:store.length},(_,i)=>store.key(i)),['seed','second']);
  assert.equal(store.key(99),null);assert.deepEqual(Object.keys(store),['seed','second']);
  store.clear();assert.equal(store.length,0);
  assert.equal(local.getItem('annora.studio.products.v1'),'original studio');assert.equal(local.getItem('nhi-patrick-demo-v1'),'main case');
  window.sessionStorage.setItem('guide','separate');window.sessionStorage.clear();assert.equal(session.getItem('unrelated'),'keep');
});

test('preview drawing database operations and listing are namespaced',async()=>{
  const {window,calls}=install();window.indexedDB.open('drawing-assets',2);window.indexedDB.deleteDatabase('drawing-assets');
  assert.deepEqual(calls,[['open',PREFIX+'drawing-assets',2],['delete',PREFIX+'drawing-assets']]);
  const databases=await window.indexedDB.databases();assert.deepEqual(JSON.parse(JSON.stringify(databases)),[{name:'drawing-assets',version:2}]);
});

test('preview ignores unrelated storage events and exposes logical keys for its own events',()=>{
  const {window,local,listeners}=install();let stopped=false;
  listeners.storage({key:'nhi-patrick-demo-v1',stopImmediatePropagation(){stopped=true;}});assert.equal(stopped,true);
  const own={key:PREFIX+'annora.studio.products.v1',storageArea:local,stopImmediatePropagation(){throw Error('own event should remain');}};listeners.storage(own);
  assert.equal(own.key,'annora.studio.products.v1');assert.equal(own.storageArea,window.localStorage);
});

test('a failed namespace installation never reports ready',()=>{
  const {window,local}=install({blocked:true});
  assert.equal(window.__NHI_CAPABILITY_STORAGE__.ready,false);
  assert.equal(local.getItem('annora.studio.products.v1'),'original studio');
});

test('every copied application entry gates runtime execution on successful isolation',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../capability-preview/snapshot-provenance.json',import.meta.url),'utf8'));
  assert.ok(manifest.adaptedEntries.includes('index.html'));assert.ok(manifest.adaptedEntries.includes('studio/index.html'));
  for(const entry of manifest.adaptedEntries){
    const html=readFileSync(new URL(`../capability-preview/${entry}`,import.meta.url),'utf8');
    assert.ok(html.indexOf('storage-isolation.js')<html.indexOf('window.__NHI_CAPABILITY_STORAGE__?.ready'),entry);
    assert.match(html,/if\(window\.__NHI_CAPABILITY_STORAGE__\?\.ready\)\{import\(/,entry);
    assert.doesNotMatch(html,/<script\s+type="module"[^>]+src=/,entry);
  }
});
