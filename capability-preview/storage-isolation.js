/* NHI Patrick capability snapshot adapter. Runs only inside copied preview pages.
   It changes browser-local persistence names, never upstream runtime behavior. */
(function installCapabilityStorage(window){
  'use strict';
  const prefix='nhi-patrick-capability-v1:';
  const result={ready:false,prefix,error:''};
  function namespacedStorage(native){
    const keys=()=>Array.from({length:native.length},(_,index)=>native.key(index)).filter(key=>typeof key==='string'&&key.startsWith(prefix));
    const store={
      getItem(key){return native.getItem(prefix+String(key));},
      setItem(key,value){native.setItem(prefix+String(key),String(value));},
      removeItem(key){native.removeItem(prefix+String(key));},
      clear(){for(const key of keys())native.removeItem(key);},
      key(index){const key=keys()[Number(index)>>>0];return key===undefined?null:key.slice(prefix.length);},
      get length(){return keys().length;}
    };
    Object.defineProperty(store,Symbol.toStringTag,{value:'Storage',configurable:true});
    return new Proxy(store,{
      get(target,key,receiver){return Reflect.has(target,key)?Reflect.get(target,key,receiver):typeof key==='string'?store.getItem(key)??undefined:undefined;},
      set(target,key,value){if(typeof key!=='string')return false;store.setItem(key,value);return true;},
      deleteProperty(target,key){if(typeof key==='string')store.removeItem(key);return true;},
      ownKeys(){return keys().map(key=>key.slice(prefix.length));},
      getOwnPropertyDescriptor(target,key){if(typeof key==='string'&&store.getItem(key)!==null)return {value:store.getItem(key),writable:true,enumerable:true,configurable:true};return Reflect.getOwnPropertyDescriptor(target,key);}
    });
  }
  function unavailable(){
    const show=()=>{
      const paragraph=window.document.createElement('p');paragraph.setAttribute('role','alert');
      paragraph.textContent='The separate capability preview could not isolate its local storage. The sample has not started. Return to the NHI demonstration.';
      paragraph.style.cssText='max-width:52em;margin:48px auto;padding:24px;font:16px/1.6 system-ui;background:#fff;color:#20262b;border:1px solid #dadee2';
      window.document.body.append(paragraph);
    };
    if(window.document.readyState==='loading')window.document.addEventListener('DOMContentLoaded',show,{once:true});else show();
  }
  try{
    const nativeLocal=window.localStorage,nativeSession=window.sessionStorage;
    const local=namespacedStorage(nativeLocal),session=namespacedStorage(nativeSession);
    Object.defineProperty(window,'localStorage',{configurable:true,get:()=>local});
    Object.defineProperty(window,'sessionStorage',{configurable:true,get:()=>session});
    const database=window.indexedDB;
    if(database){
      const facade={
        open(name,version){return arguments.length>1?database.open(prefix+String(name),version):database.open(prefix+String(name));},
        deleteDatabase(name){return database.deleteDatabase(prefix+String(name));},
        cmp(first,second){return database.cmp(first,second);}
      };
      if(typeof database.databases==='function')facade.databases=async()=>
        (await database.databases()).filter(item=>typeof item.name==='string'&&item.name.startsWith(prefix)).map(item=>({...item,name:item.name.slice(prefix.length)}));
      Object.defineProperty(window,'indexedDB',{configurable:true,get:()=>facade});
    }
    // Native cross-window events contain physical keys. Only this namespace is
    // relevant to the copied application; expose its logical key to listeners.
    window.addEventListener('storage',event=>{
      if(typeof event.key!=='string'||!event.key.startsWith(prefix)){event.stopImmediatePropagation();return;}
      try{
        Object.defineProperty(event,'key',{value:event.key.slice(prefix.length)});
        if(event.storageArea===nativeLocal)Object.defineProperty(event,'storageArea',{value:local});
        if(event.storageArea===nativeSession)Object.defineProperty(event,'storageArea',{value:session});
      }catch{event.stopImmediatePropagation();}
    },true);
    result.ready=true;
  }catch(error){result.error=String(error?.message||error);unavailable();}
  window.__NHI_CAPABILITY_STORAGE__=Object.freeze(result);
})(window);
