import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmbedBridge, EMBED_PROTOCOL, configuredParentOrigin } from '../../src/explorer/embed-bridge.js';
import { createExplorerClient } from '../../src/explorer/embed-client.js';
import { bindHostLifecycle, revealMobileViewer } from '../../examples/embed/lifecycle.js';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function transport(){
  const host={listeners:new Set()},child={listeners:new Set()},sent=[];
  for(const win of [host,child]){const types=new Map();win.addEventListener=(type,fn)=>{win.listeners.add(fn);types.set(fn,type);};win.removeEventListener=(type,fn)=>{win.listeners.delete(fn);types.delete(fn);};win.dispatch=event=>{for(const fn of win.listeners)if(types.get(fn)===(event.type||'message'))fn(event);};}
  const childPeer={postMessage(data,targetOrigin){sent.push({to:'child',data,targetOrigin});child.dispatch({data,origin:'https://host.test',source:parentPeer});}};
  const parentPeer={postMessage(data,targetOrigin){sent.push({to:'host',data,targetOrigin});host.dispatch({data,origin:'https://explorer.test',source:childPeer});}};
  child.parent=parentPeer;
  return {host,child,iframe:{contentWindow:childPeer},sent,send(data,extra={}){child.dispatch({data,origin:'https://host.test',source:parentPeer,...extra});},reply(data,extra={}){host.dispatch({data,origin:'https://explorer.test',source:childPeer,...extra});}};
}
function controller(){
  const listeners=new Set(),calls=[];let seq=0;
  const value={instanceId:'instance-1',stateRevision:1,lifecycle:'ready'};
  const emit=(type,payload,requestId)=>{const event={protocolVersion:EMBED_PROTOCOL,instanceId:value.instanceId,stateRevision:value.stateRevision,eventSequence:++seq,type,payload,...(requestId?{requestId}:{})};for(const fn of listeners)fn(event);return event;};
  return {calls,listeners,emit,getState:()=>({...value}),getCapabilities:()=>({renderStyles:{available:['engineering','linework','flat']}}),subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},request(request){calls.push(request);return Promise.resolve(emit('commandResult',{status:'completed',result:{method:request.method}},request.requestId));}};
}
const hello=nonce=>({protocolVersion:EMBED_PROTOCOL,type:'hello',nonce});
const command=(sessionId,requestId='one',method='getState',params={})=>({protocolVersion:EMBED_PROTOCOL,type:'command',sessionId,requestId,method,params});
function lastAck(wire){return wire.sent.filter(item=>item.to==='host'&&item.data.type==='helloAck').at(-1)?.data;}

test('embedding requires an explicit exact HTTP(S) parent origin',()=>{
  assert.equal(configuredParentOrigin({search:'?embed=1&parentOrigin=https%3A%2F%2Fhost.test'}),'https://host.test');
  for(const search of ['?parentOrigin=https://host.test','?embed=1&parentOrigin=*','?embed=1&parentOrigin=https://host.test/path','?embed=1&parentOrigin=null'])assert.equal(configuredParentOrigin({search}),null);
});
test('bridge rejects wrong origin, source, protocol and malformed nonce',()=>{
  const wire=transport(),runtime=controller();const dispose=createEmbedBridge({controller:runtime,parentOrigin:'https://host.test',window:wire.child});
  wire.send(hello('a'),{origin:'https://attacker.test'});wire.send(hello('a'),{source:{}});wire.send({...hello('a'),protocolVersion:'old'});wire.send(hello('bad nonce'));
  assert.equal(wire.sent.length,0);wire.send(hello('good-nonce'));assert.ok(lastAck(wire)?.sessionId);
  assert.ok(wire.sent.every(item=>item.targetOrigin==='https://host.test'));dispose();assert.equal(wire.child.listeners.size,0);assert.equal(runtime.listeners.size,0);
});
test('repeated hello keeps its session; a fresh nonce invalidates old commands and old hello',async()=>{
  const wire=transport(),runtime=controller();const dispose=createEmbedBridge({controller:runtime,parentOrigin:'https://host.test',window:wire.child});
  wire.send(hello('first'));const first=lastAck(wire).sessionId;wire.send(hello('first'));assert.equal(lastAck(wire).sessionId,first);
  wire.send(hello('second'));const second=lastAck(wire).sessionId;assert.notEqual(second,first);
  wire.send(command(first));wire.send(hello('first'));assert.equal(lastAck(wire).sessionId,second);assert.equal(runtime.calls.length,0);
  wire.send(command(second));await tick();assert.equal(runtime.calls.length,1);dispose();
});
test('terminal result is sent once despite controller subscription and duplicate in-flight messages',async()=>{
  const wire=transport(),runtime=controller();let complete;runtime.request=request=>{runtime.calls.push(request);return new Promise(resolve=>{complete=()=>resolve(runtime.emit('commandResult',{status:'completed',result:{}},request.requestId));});};
  const dispose=createEmbedBridge({controller:runtime,parentOrigin:'https://host.test',window:wire.child});wire.send(hello('one'));const sessionId=lastAck(wire).sessionId;
  wire.send(command(sessionId,'render','setRenderStyle',{style:'linework'}));wire.send(command(sessionId,'render','setRenderStyle',{style:'linework'}));
  assert.equal(runtime.calls.length,1);complete();await tick();const results=wire.sent.filter(item=>item.data.type==='commandResult');assert.equal(results.length,1);assert.equal(results[0].data.requestId,'render');assert.equal(results[0].data.eventSequence,1);dispose();
});
test('bounded JSON and method allowlist reject unsafe input using safe failure envelopes',async()=>{
  const wire=transport(),runtime=controller();const dispose=createEmbedBridge({controller:runtime,parentOrigin:'https://host.test',window:wire.child});wire.send(hello('one'));const id=lastAck(wire).sessionId;
  wire.send(command(id,'a','__proto__'));wire.send(command(id,'b','setExplosion',{progress:Infinity}));wire.send(command(id,'c','select',{nodeId:'x'.repeat(66000)}));wire.send(command(id,'d','select',{nodeId:()=>{}}));await tick();
  assert.ok(runtime.calls.every(call=>call.method==='__invalid_transport_request__'&&Object.keys(call.params).length===0));const failures=wire.sent.filter(item=>item.data.payload?.error?.code==='INVALID_REQUEST');assert.equal(failures.length,4);assert.deepEqual(failures.map(item=>item.data.eventSequence),[1,2,3,4]);dispose();
});
test('client verifies source/origin/nonce and only accepts its current session',async()=>{
  const wire=transport();const client=createExplorerClient({iframe:wire.iframe,origin:'https://explorer.test',window:wire.host,handshakeTimeoutMs:1000});
  const nonce=wire.sent[0].data.nonce;const ack={protocolVersion:EMBED_PROTOCOL,type:'helloAck',nonce,sessionId:'session',instanceId:'instance',payload:{state:{lifecycle:'loading'}}};
  wire.reply(ack,{origin:'https://wrong.test'});wire.reply(ack,{source:{}});wire.reply({...ack,nonce:'wrong'});assert.equal(client.sessionId,null);wire.reply(ack);await client.ready;
  const result=client.request('getState',{}, {requestId:'r'});await tick();
  const response={protocolVersion:EMBED_PROTOCOL,type:'commandResult',sessionId:'session',instanceId:'instance',requestId:'r',payload:{status:'completed',result:{}}};
  wire.reply({...response,sessionId:'old'});wire.reply({...response,instanceId:'wrong'});wire.reply(response);assert.equal((await result).payload.status,'completed');client.close();assert.equal(wire.host.listeners.size,0);
});
test('cross-origin client communicates through API only and preserves controller sequencing',async()=>{
  const wire=transport(),runtime=controller();const stop=createEmbedBridge({controller:runtime,parentOrigin:'https://host.test',window:wire.child});
  const client=createExplorerClient({iframe:wire.iframe,origin:'https://explorer.test',window:wire.host});const events=[];client.subscribe(event=>events.push(event));await client.ready;
  const result=await client.request('setRenderStyle',{style:'flat'});assert.equal(result.payload.result.method,'setRenderStyle');assert.equal(events.filter(event=>event.type==='commandResult').length,1);
  runtime.emit('stateChanged',runtime.getState());assert.equal(events.at(-1).eventSequence,2);assert.ok(wire.sent.every(item=>item.targetOrigin!=='*'));client.close();stop();
});
test('client timeout requests cancellation; it never reports the command completed',async()=>{
  const wire=transport(),runtime=controller();runtime.request=request=>{runtime.calls.push(request);return request.method==='cancel'?Promise.resolve(runtime.emit('commandResult',{status:'completed',result:{}},request.requestId)):new Promise(()=>{});};
  const stop=createEmbedBridge({controller:runtime,parentOrigin:'https://host.test',window:wire.child});const client=createExplorerClient({iframe:wire.iframe,origin:'https://explorer.test',window:wire.host,timeoutMs:15});await client.ready;
  await assert.rejects(client.request('focus',{nodeId:'assembly'}),error=>error.code==='REQUEST_TIMEOUT');assert.equal(runtime.calls.at(-1).method,'cancel');client.close();stop();
});
test('disposing the connection rejects outstanding requests and releases listeners',async()=>{
  const wire=transport(),runtime=controller();runtime.request=()=>new Promise(()=>{});const stop=createEmbedBridge({controller:runtime,parentOrigin:'https://host.test',window:wire.child});const client=createExplorerClient({iframe:wire.iframe,origin:'https://explorer.test',window:wire.host});await client.ready;
  const request=client.request('focus',{nodeId:'root'});const rejected=assert.rejects(request,error=>error.code==='DISPOSED');await tick();client.close();await rejected;stop();assert.equal(wire.host.listeners.size,0);assert.equal(wire.child.listeners.size,0);
});
test('late old-session async results cannot leak into a new handshake',async()=>{
  const wire=transport(),runtime=controller();let complete;runtime.request=request=>request.method==='cancel'?Promise.resolve(runtime.emit('commandResult',{status:'completed'},request.requestId)):new Promise(resolve=>{complete=()=>resolve(runtime.emit('commandResult',{status:'completed'},request.requestId));});
  const stop=createEmbedBridge({controller:runtime,parentOrigin:'https://host.test',window:wire.child});wire.send(hello('old'));wire.send(command(lastAck(wire).sessionId));wire.send(hello('new'));complete();await tick();assert.equal(wire.sent.filter(item=>item.data.type==='commandResult').length,0);stop();
});
test('handshake retries are bounded and disposal before readiness rejects cleanly',async()=>{
  const wire=transport();const client=createExplorerClient({iframe:wire.iframe,origin:'https://explorer.test',window:wire.host,retryMs:5,handshakeTimeoutMs:20});await assert.rejects(client.ready,error=>error.code==='HANDSHAKE_TIMEOUT');assert.ok(wire.sent.length>=2);const count=wire.sent.length;await new Promise(resolve=>setTimeout(resolve,15));assert.equal(wire.sent.length,count);client.close();
  const other=createExplorerClient({iframe:wire.iframe,origin:'https://explorer.test',window:wire.host});const rejected=assert.rejects(other.ready,error=>error.code==='DISPOSED');other.close();await rejected;
});

test('capacity limits never block cancellation of pending requests',async()=>{
  const wire=transport(),runtime=controller();runtime.request=request=>{runtime.calls.push(request);return ['cancel','__invalid_transport_request__'].includes(request.method)?Promise.resolve(runtime.emit('commandResult',{status:'completed',result:{}},request.requestId)):new Promise(()=>{});};
  const stop=createEmbedBridge({controller:runtime,parentOrigin:'https://host.test',window:wire.child});wire.send(hello('one'));const session=lastAck(wire).sessionId;
  for(let i=0;i<32;i++)wire.send(command(session,`request-${i}`,'focus',{nodeId:'root'}));
  wire.send(command(session,'over-limit','focus',{nodeId:'root'}));wire.send(command(session,'cancel-full','cancel',{requestId:'request-0'}));await tick();
  assert.equal(runtime.calls.filter(call=>call.method==='focus').length,32);assert.ok(runtime.calls.some(call=>call.method==='cancel'&&call.params.requestId.endsWith(':request-0')));stop();
});
test('busy state returns external request IDs instead of session-private IDs',async()=>{
  const wire=transport(),runtime=controller();const stop=createEmbedBridge({controller:runtime,parentOrigin:'https://host.test',window:wire.child});wire.send(hello('one'));const session=lastAck(wire).sessionId;
  runtime.emit('stateChanged',{...runtime.getState(),busy:[{requestId:`${session}:focus-1`,activity:'focus'}]});
  assert.equal(wire.sent.at(-1).data.payload.busy[0].requestId,'focus-1');stop();
});


test('a restored host retains its connection across repeated bfcache visits, then closes on real departure',async()=>{
  const wire=transport(),runtime=controller();const stop=createEmbedBridge({controller:runtime,parentOrigin:'https://host.test',window:wire.child});
  const client=createExplorerClient({iframe:wire.iframe,origin:'https://explorer.test',window:wire.host});await client.ready;
  const unbind=bindHostLifecycle({window:wire.host,getClient:()=>client});
  for(let visit=0;visit<2;visit++){wire.host.dispatch({type:'pagehide',persisted:true});wire.host.dispatch({type:'pageshow',persisted:true});const event=await client.request('getState');assert.equal(event.payload.status,'completed');}
  wire.host.dispatch({type:'pagehide',persisted:false});await assert.rejects(client.request('getState'),error=>error.code==='DISPOSED');
  unbind();stop();assert.equal(wire.host.listeners.size,0);assert.equal(wire.child.listeners.size,0);
});


test('stacked mobile controls reveal the iframe before scheduling visual work',async()=>{
  const order=[],frames=[];const window={matchMedia:()=>({matches:true}),innerHeight:700,requestAnimationFrame:fn=>frames.push(fn),cancelAnimationFrame:()=>{}};
  const viewer={getBoundingClientRect:()=>({top:-800,bottom:-150,height:650}),scrollIntoView:options=>{order.push('reveal');assert.equal(options.block,'start');}};
  const command=(async()=>{await revealMobileViewer({window,viewer,onReveal:()=>order.push('announce')});order.push('command');})();
  assert.deepEqual(order,['reveal','announce']);frames.shift()();assert.equal(order.includes('command'),false);frames.shift()();await command;assert.deepEqual(order,['reveal','announce','command']);
});
test('desktop and already visible mobile viewers do not move the page',async()=>{
  let scrolls=0;const viewer={getBoundingClientRect:()=>({top:0,bottom:600,height:600}),scrollIntoView:()=>{scrolls++;}};
  assert.equal(await revealMobileViewer({window:{matchMedia:()=>({matches:false})},viewer}),false);
  assert.equal(await revealMobileViewer({window:{matchMedia:()=>({matches:true}),innerHeight:700},viewer}),false);assert.equal(scrolls,0);
});
