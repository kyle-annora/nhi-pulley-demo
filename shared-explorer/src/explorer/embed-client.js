/** Host-side integration client. Uses postMessage exclusively, including same-origin embeds. */
import { EMBED_PROTOCOL, exactOrigin } from './embed-bridge.js';
let serial=0;
const uid=prefix=>`${prefix}-${globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${++serial}`}`;
const problem=(code,message)=>Object.assign(new Error(message),{code});

export function createExplorerClient({iframe,origin,window:win=globalThis.window,timeoutMs=30000,handshakeTimeoutMs=12000,retryMs=300}) {
  if(!iframe?.contentWindow||!exactOrigin(origin))throw new TypeError('An iframe and exact HTTP(S) Explorer origin are required.');
  const peer=iframe.contentWindow,nonce=uid('hello'),listeners=new Set(),pending=new Map();
  let sessionId=null,instanceId=null,disposed=false,handshakeTimer,retryTimer,lastEventSequence=0;
  let resolveReady,rejectReady;
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  const post=message=>{if(!disposed)peer.postMessage({...message,protocolVersion:EMBED_PROTOCOL},origin);};
  const emit=event=>{for(const listener of listeners)try{listener(event);}catch{/* A consumer listener cannot break transport. */}};
  const failAll=(code,message)=>{for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(problem(code,message));}pending.clear();};
  function onMessage(event){
    if(disposed||event.origin!==origin||event.source!==peer||!event.data||typeof event.data!=='object')return;
    const data=event.data;
    if(data.protocolVersion!==EMBED_PROTOCOL)return;
    if(data.type==='helloAck'){
      if(data.nonce!==nonce||typeof data.sessionId!=='string'||!data.sessionId||typeof data.instanceId!=='string'||!data.instanceId||!data.payload?.state)return;
      if(sessionId&&sessionId!==data.sessionId)return;
      if(sessionId)return;
      sessionId=data.sessionId;instanceId=data.instanceId;clearTimeout(handshakeTimer);clearInterval(retryTimer);
      resolveReady(data.payload);emit(data);return;
    }
    if(!sessionId||data.sessionId!==sessionId||data.instanceId!==instanceId)return;
    if(data.type==='commandResult'){
      const entry=pending.get(data.requestId);if(!entry||!['completed','failed','cancelled'].includes(data.payload?.status))return;
      pending.delete(data.requestId);clearTimeout(entry.timer);entry.resolve(data);emit(data);return;
    }
    if(!Number.isSafeInteger(data.eventSequence)||data.eventSequence<=lastEventSequence)return;
    lastEventSequence=data.eventSequence;emit(data);
  }
  win.addEventListener('message',onMessage);
  const hello=()=>post({type:'hello',nonce});
  retryTimer=setInterval(hello,retryMs);
  handshakeTimer=setTimeout(()=>{rejectReady(problem('HANDSHAKE_TIMEOUT','The Explorer connection did not respond.'));close();},handshakeTimeoutMs);
  hello();
  async function request(method,params={},options={}){
    if(disposed)throw problem('DISPOSED','This connection has been closed.');
    await ready;
    if(disposed)throw problem('DISPOSED','This connection has been closed.');
    const requestId=options.requestId||uid('request');
    if(!/^[A-Za-z0-9_.:-]{1,64}$/.test(requestId))throw problem('INVALID_REQUEST','Invalid request ID.');
    if(pending.has(requestId))throw problem('INVALID_REQUEST','This request ID is already pending.');
    if(pending.size>=32&&!['cancel','dispose'].includes(method))throw problem('INVALID_REQUEST','Too many requests are pending.');
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        pending.delete(requestId);
        post({type:'command',sessionId,requestId:uid('timeout-cancel'),method:'cancel',params:{requestId}});
        reject(problem('REQUEST_TIMEOUT','The request timed out; cancellation was requested. Its final state is unknown until refreshed.'));
      },options.timeoutMs??timeoutMs);
      pending.set(requestId,{resolve,reject,timer});
      try{post({type:'command',sessionId,requestId,method,params});}
      catch{clearTimeout(timer);pending.delete(requestId);reject(problem('INVALID_REQUEST','The request must contain cloneable JSON data.'));}
    });
  }
  function close(){
    if(disposed)return;disposed=true;clearTimeout(handshakeTimer);clearInterval(retryTimer);win.removeEventListener('message',onMessage);
    rejectReady(problem('DISPOSED','The connection closed before the handshake completed.'));failAll('DISPOSED','The Explorer connection has been closed.');listeners.clear();
  }
  return {ready,request,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},close,get sessionId(){return sessionId;},get instanceId(){return instanceId;}};
}
