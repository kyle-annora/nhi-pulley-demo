import {createExplorerClient} from '../shared-explorer/src/explorer/embed-client.js';
import {F4412_MODEL_META} from './f4412-model-meta.mjs';

export const F4412_EXPLORER=Object.freeze({
  modelId:'f4412',rootId:'f4412',tourId:'f4412-inspection',
  chapters:Object.freeze(['belt','flange','mount']),
  runtimeRevision:'f077210f79635dbd8e4ec9f66511a6cfc2c5f174',
  modelRevision:F4412_MODEL_META.modelRevision,
  source:'https://newhampshireindustries.s3.amazonaws.com/NHI+Idler+%26+Drive+Pulleys+Catalog.pdf#page=6',
});

export function explorerURL(base=globalThis.window.location.href){
  const url=new URL('./shared-explorer/dist/',base);
  url.searchParams.set('embed','1');url.searchParams.set('parentOrigin',new URL(base).origin);
  url.searchParams.set('model',F4412_EXPLORER.modelId);url.searchParams.set('host','nhi');
  return url.href;
}

export function createF4412Explorer({iframe,onState=()=>{},onError=()=>{}}){
  if(!iframe.getAttribute('src'))iframe.src=explorerURL();
  const client=createExplorerClient({iframe,origin:new URL(iframe.src).origin});
  let state=null,capabilities=null,disposed=false,readyResolve,readyReject,queue=Promise.resolve(),intent=0;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const timer=setTimeout(()=>readyReject(Error('The F-4412 model is taking too long to load. Retry the Explorer or use the catalog drawing.')),25000);
  function accept(next){
    if(disposed||!next)return;state=next;onState(next);
    if(next.lifecycle==='error'){clearTimeout(timer);readyReject(Error('The F-4412 model could not be loaded.'));}
    if(next.lifecycle==='ready'){clearTimeout(timer);readyResolve(next);}
  }
  const unsubscribe=client.subscribe(event=>{
    if(event.type==='stateChanged')accept(event.payload);
    if(event.type==='ready'){capabilities=event.payload.capabilities;accept(event.payload.state);}
    if(event.type==='error')onError(Error(event.payload.message||'Explorer unavailable.'));
  });
  client.ready.then(handshake=>{capabilities=handshake.capabilities;accept(handshake.state);}).catch(error=>{if(!disposed){clearTimeout(timer);readyReject(error);}});
  // Attach a rejection handler even when the host removes an iframe while loading.
  ready.catch(error=>{if(!disposed)onError(error);});
  async function request(method,params={}){
    if(disposed)throw Object.assign(Error('The Explorer has been closed.'),{code:'DISPOSED'});
    const response=await client.request(method,params);
    if(response.payload.status!=='completed'){
      const details=response.payload.error;
      throw Object.assign(Error(details?.message||`Explorer action ${response.payload.status}.`),{code:details?.code||response.payload.status});
    }
    return response.payload.result;
  }
  async function command(method,params={}){
    await ready;
    return request(method,params);
  }
  // The last requested chapter wins. Requests are serialized so an earlier
  // startTour cannot land after the final chapter selection.
  function showTheme(key,{play=false}={}){
    if(!['overview',...F4412_EXPLORER.chapters].includes(key))return Promise.reject(Error('Unknown inspection theme.'));
    const ownIntent=++intent;
    const task=queue.catch(()=>{}).then(async()=>{
      await ready;if(disposed||ownIntent!==intent)return {superseded:true};
      capabilities=await request('getCapabilities');
      if(key==='overview'){
        if(state?.tour?.active)await request('exitTour',{restore:false});
        if(ownIntent!==intent)return {superseded:true};
        await request('focus',{nodeId:F4412_EXPLORER.rootId});
        if(ownIntent!==intent)return {superseded:true};
        await request('frame',{nodeId:F4412_EXPLORER.rootId,view:'front'});
        await request('setRenderStyle',{style:'engineering'});
      }else{
        if(!capabilities.tours?.available||!capabilities.tours.items.some(t=>t.id===F4412_EXPLORER.tourId))throw Error('The inspection tour is unavailable for this model.');
        if(!state?.tour?.active)await request('startTour',{tourId:F4412_EXPLORER.tourId});
        if(ownIntent!==intent)return {superseded:true};
        await request('goToTourChapter',{chapterId:key});
        // Playback is an explicit host action. The shared player owns timing,
        // reduced motion and its pause at the end of this authored chapter.
        if(play&&ownIntent===intent)await request('resumeTour');
      }
      const current=await request('getState');accept(current);return current;
    });
    queue=task;return task;
  }
  async function dispose(){
    if(disposed)return;disposed=true;++intent;clearTimeout(timer);unsubscribe();
    readyReject(Object.assign(Error('The Explorer has been closed.'),{code:'DISPOSED'}));
    try{await Promise.race([client.request('dispose'),new Promise(resolve=>setTimeout(resolve,500))]);}catch{}finally{client.close();}
  }
  return {ready,command,showTheme,dispose,get state(){return state;},get capabilities(){return capabilities;}};
}
