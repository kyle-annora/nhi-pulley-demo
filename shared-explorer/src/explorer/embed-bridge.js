/** Exact-origin transport around the shared controller. No DOM or renderer access. */
export const EMBED_PROTOCOL = 'annora.explorer/0.1-draft';
const METHODS = new Set(['getCapabilities','getState','getNode','getChildren','getTour','select','focus','frame','isolate','setRenderStyle','setMode','setExplosion','pauseExplosion','resumeExplosion','replayExplosion','replayOperation','playOperation','pauseOperation','seekOperation','setOperationSpeed','setFollowCamera','startTour','pauseTour','resumeTour','seekTour','goToTourChapter','exitTour','setTheme','setQuality','captureView','restoreView','cancel','dispose']);
const TOKEN = /^[A-Za-z0-9_.:-]{1,96}$/;
let sequence = 0;
const token = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${(++sequence).toString(36)}`}`;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
function safeJSON(value, depth = 0) {
  if (depth > 12) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 512 && value.every(item => safeJSON(item, depth + 1));
  return record(value) && Object.keys(value).length <= 128 && Object.entries(value).every(([key,item]) => !['__proto__','prototype','constructor'].includes(key) && safeJSON(item, depth + 1));
}
export function exactOrigin(value) {
  try { const url = new URL(value); return ['http:','https:'].includes(url.protocol) && url.origin === value ? value : null; } catch { return null; }
}
export function configuredParentOrigin(location) {
  const params = new URLSearchParams(location.search);
  return params.get('embed') === '1' ? exactOrigin(params.get('parentOrigin')) : null;
}

export function createEmbedBridge({controller, parentOrigin, window: win = globalThis.window}) {
  const origin = exactOrigin(parentOrigin);
  if (!origin || !win || win.parent === win) return () => {};
  const parent = win.parent;
  let session = null, closed = false;
  const usedNonces = new Set(), pending = new Map();
  const send = message => { if (!closed) parent.postMessage(message, origin); };
  const state = () => controller.getState();
  const externalize = (value,current,key) => {
    if(key==='requestId' && typeof value==='string' && value.startsWith(current.prefix))return value.slice(current.prefix.length);
    if(Array.isArray(value))return value.map(item=>externalize(item,current));
    if(record(value))return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,externalize(item,current,key)]));
    return value;
  };
  const stamp = (event,current) => {
    const {sessionId:ignored,...copy} = event;
    if (copy.requestId) {
      if (!copy.requestId.startsWith(current.prefix)) return null;
      copy.requestId = copy.requestId.slice(current.prefix.length);
    }
    return {...copy,payload:externalize(copy.payload,current),protocolVersion:EMBED_PROTOCOL,sessionId:current.id};
  };
  const reject = async (requestId,message) => {
    const current=session;
    // The controller alone owns eventSequence. Only a small safe rejection
    // envelope crosses this boundary, never the malformed host parameters.
    const result=await controller.request({requestId:current.prefix+requestId,method:'__invalid_transport_request__',params:{}});
    if(closed||session!==current)return;
    const event=stamp(result,current);
    send({...event,payload:{status:'failed',error:{code:'INVALID_REQUEST',message,retryable:false}}});
  };
  const cancelOld = old => {
    for (const [id] of pending) if (id.startsWith(old.prefix)) {
      // Cancellation remains a controller action; no private scene mutation.
      controller.request({requestId:token('bridge-cancel'),method:'cancel',params:{requestId:id}}).catch(()=>{});
      pending.delete(id);
    }
  };
  const hello = message => {
    if (message.protocolVersion !== EMBED_PROTOCOL || typeof message.nonce !== 'string' || !TOKEN.test(message.nonce)) return;
    if (!session || session.nonce !== message.nonce) {
      if (usedNonces.has(message.nonce) || usedNonces.size >= 64) return;
      if (session) cancelOld(session);
      const id=token('session');session={id,nonce:message.nonce,prefix:`${id}:`};usedNonces.add(message.nonce);
    }
    send({protocolVersion:EMBED_PROTOCOL,type:'helloAck',nonce:session.nonce,sessionId:session.id,instanceId:state().instanceId,payload:{state:state(),capabilities:controller.getCapabilities()}});
  };
  const unsubscribe = controller.subscribe(event => {
    if (!session || event.type === 'commandResult') return;
    const output=stamp(event,session);if(output)send(output);
  });
  async function onMessage(event) {
    if (closed || event.origin !== origin || event.source !== parent || !record(event.data)) return;
    const message = event.data;
    if (message.type === 'hello') { hello(message); return; }
    if (!session || message.protocolVersion !== EMBED_PROTOCOL || message.sessionId !== session.id || message.type !== 'command') return;
    if (typeof message.requestId !== 'string' || !TOKEN.test(message.requestId) || message.requestId.length > 64) return;
    if (!Object.keys(message).every(key=>['protocolVersion','sessionId','requestId','type','method','params'].includes(key)) || !METHODS.has(message.method) || !record(message.params ?? {}) || !safeJSON(message) || JSON.stringify(message).length > 65536) {
      await reject(message.requestId,'The request does not match the Explorer command contract.');return;
    }
    const current=session, internalId=current.prefix+message.requestId;
    if (pending.size >= 32 && !pending.has(internalId) && !['cancel','dispose'].includes(message.method)) {await reject(message.requestId,'Too many requests are pending.');return;}
    const params={...(message.params || {})};
    if(message.method==='cancel') {
      if(typeof params.requestId!=='string' || !TOKEN.test(params.requestId) || params.requestId.length>64){await reject(message.requestId,'A valid request ID is required.');return;}
      params.requestId=current.prefix+params.requestId;
    }
    // The controller owns ID deduplication, including mismatched argument rejection.
    const signature=JSON.stringify([message.method,params],(_,value)=>record(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);
    const existing=pending.get(internalId);
    if(existing?.signature===signature)return;
    if(existing){await reject(message.requestId,'This request ID is already pending with different arguments.');return;}
    const promise=controller.request({requestId:internalId,method:message.method,params});
    const entry={promise,signature};pending.set(internalId,entry);
    try {
      const response=await promise;
      if(closed||session!==current)return;
      const output=stamp(response,current);if(output)send(output);
    } catch {
      if(!closed&&session===current)await reject(message.requestId,'The request could not be completed.');
    } finally {if(pending.get(internalId)===entry)pending.delete(internalId);}
  }
  win.addEventListener('message',onMessage);
  return () => {
    if(closed)return;closed=true;win.removeEventListener('message',onMessage);unsubscribe();
    if(session)cancelOld(session);pending.clear();session=null;
  };
}
