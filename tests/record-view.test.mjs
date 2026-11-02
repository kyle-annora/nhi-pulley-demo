import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initialState,restoreState,saveRFQ} from '../src/domain.mjs';
import {commercialContext} from '../src/commercial-adapter.mjs';
import {inquiryDocument} from '../src/rfq-adapter.mjs';
import {parseWorkspaceRoute,recordHref,resolveRecordView} from '../src/record-view.mjs';

const fixture=()=>restoreState(readFileSync(new URL('./fixtures/round19-before-sample-case.json',import.meta.url),'utf8'));
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

test('reading an older quote leaves the active v2, pending 300 request and every saved record unchanged',()=>{
  const state=fixture();state.draft.quantity='400';
  freeze(state);const before=JSON.stringify(state);
  const result=resolveRecordView(state,{source:'quote',id:'Q-DEMO-003',version:'1'});
  assert.equal(result.error,null);assert.equal(result.record.version,1);
  assert.equal(result.record.requirements.quantity,'200');
  assert.equal(result.latestQuote.version,2);assert.equal(result.latestQuote.requirements.quantity,'250');
  const current=commercialContext(state);
  assert.equal(current.pendingRevisions[0].changes.find(change=>change.field==='quantity').after,'300');
  assert.equal(state.activeQuoteVersion,2);assert.equal(state.draft.quantity,'400');
  assert.equal(JSON.stringify(state),before);
  result.record.requirements.quantity='999';result.latestQuote.requirements.quantity='999';result.rfq.requirements.quantity='999';result.items[0].detail='Changed only in the presentation';
  assert.equal(JSON.stringify(state),before);
});

test('saved RFQ details keep their own questions and scope while another product and draft are active',()=>{
  const state=fixture(),record=state.rfqs[1];
  state.draft.speed='1500';state.draft.load='80';state.draft.explorerRequirements=[];state.selected='F-4414';
  state.quotes.find(q=>q.id==='Q-DEMO-002'&&q.version===2).reviewItems=[];
  const result=resolveRecordView(state,{source:'rfq',id:record.id,version:record.version});
  assert.equal(result.error,null);assert.equal(result.record.product.id,'F-4412');
  assert.equal(result.latestQuote.id,'Q-DEMO-002');
  assert.equal(result.items.filter(item=>item.source.kind==='explorer').length,1);
  assert.equal(result.items.find(item=>item.source.kind==='explorer').source.note,'Please review mounting dimensions, radial load and operating speed for the mower-deck application.');
  assert.equal(result.items.some(item=>item.id==='commercial:freight-tax'),false);
  assert.equal(result.items.some(item=>item.id==='application:speed'),true);
});

test('working inquiry reading uses current questions and rejects a stale product link',()=>{
  const state=fixture();state.draft.speed='1500';state.draft.explorerRequirements=[];
  const href=recordHref('draft',inquiryDocument(state));
  const {step,params}=parseWorkspaceRoute(href);
  assert.equal(step,'record');assert.equal(params.from,'review');assert.equal(params.product,'F-4412');
  assert.equal('id' in params,false);assert.equal('version' in params,false);
  const result=resolveRecordView(state,params);
  assert.equal(result.error,null);assert.equal(result.record.id,null);
  assert.equal(result.items.some(item=>item.id==='application:speed'),false);
  assert.equal(result.items.some(item=>item.source.kind==='explorer'),false);
  state.selected='F-4414';
  assert.ok(resolveRecordView(state,params).error);
  assert.ok(resolveRecordView(state,{source:'draft',product:'F-4414',id:'RFQ-DEMO-003'}).error);
});

test('new and unquoted RFQs do not borrow an active commercial record',()=>{
  const state=initialState(),draft=resolveRecordView(state,{source:'draft',product:state.selected});
  assert.equal(draft.error,null);assert.equal(draft.rfq,null);assert.equal(draft.latestQuote,null);
  const saved=saveRFQ(state,'2026-11-01T20:00:00Z').state,record=saved.rfqs[0];
  const result=resolveRecordView(saved,{source:'rfq',id:record.id,version:record.version});
  assert.equal(result.error,null);assert.equal(result.latestQuote,null);assert.equal(result.rfq.id,record.id);
});

test('invalid sources, missing versions, ambiguous identities and broken saved chains fail without fallback',()=>{
  const valid={source:'quote',id:'Q-DEMO-003',version:'2'};
  for(const params of [{},{...valid,source:'unknown'},{...valid,id:'missing'},{...valid,version:undefined},{...valid,version:'2.0'},{...valid,version:'0'},{...valid,version:'99'},{...valid,product:'F-4414'}]){
    const result=resolveRecordView(fixture(),params);
    assert.ok(result.error);assert.equal(result.record,null);assert.equal(result.latestQuote,null);
  }
  const changes=[
    s=>s.quotes.push(structuredClone(s.quotes.find(q=>q.id==='Q-DEMO-003'&&q.version===2))),
    s=>s.rfqs.push(structuredClone(s.rfqs[2])),
    s=>{s.rfqs[2].caseId='another-case';},
    s=>{s.quotes.at(-1).product.id='F-4414';},
    s=>{s.quotes.at(-1).rfqVersion=1;},
    s=>{s.replies=s.replies.filter(r=>r.id!==s.quotes.at(-1).responseId);},
    s=>{s.revisions.find(r=>r.id===s.quotes.at(-1).revisionId).rfqId='RFQ-DEMO-001';}
  ];
  for(const change of changes){const state=fixture();change(state);const before=JSON.stringify(state);assert.ok(resolveRecordView(state,valid).error);assert.equal(JSON.stringify(state),before);}
  assert.ok(resolveRecordView(fixture(),{source:'rfq',id:'RFQ-DEMO-003',version:1}).error);
});

test('legacy quote questions use their exact reply and revision rather than the latest pending request',()=>{
  const state=fixture(),q=state.quotes.find(q=>q.id==='Q-DEMO-003'&&q.version===2);
  delete q.reviewItems;
  const expectedRevision=state.revisions.find(r=>r.id===q.revisionId);
  const result=resolveRecordView(state,{source:'quote',id:q.id,version:q.version});
  assert.equal(result.error,null);
  assert.ok(result.items.some(item=>item.id===`revision:${expectedRevision.id}:question`));
  assert.equal(result.items.some(item=>item.id==='revision:REV-DEMO-004:question'),false);
  assert.ok(result.items.some(item=>item.id==='commercial:freight-tax'));
});

test('record routes round-trip IDs and question filters safely without changing their identity',()=>{
  const record={id:'Q /&?+#=中',version:2};
  const href=recordHref('quote',record,'questions',{owner:'Engineering',item:'explorer:1 / &?+#=',from:'rfq',id:'must-not-replace'});
  const {step,params}=parseWorkspaceRoute(href);
  assert.equal(step,'record');assert.equal(params.source,'quote');assert.equal(params.id,record.id);
  assert.equal(params.version,'2');assert.equal(params.section,'questions');assert.equal(params.from,'rfq');
  assert.equal(params.owner,'Engineering');assert.equal(params.item,'explorer:1 / &?+#=');
  assert.equal(href.includes('Q /'),false);
  assert.deepEqual(parseWorkspaceRoute('#review'),{step:'review',params:{}});
  assert.deepEqual(parseWorkspaceRoute('quote-document?id=Q-DEMO-003&version=1'),{step:'quote-document',params:{id:'Q-DEMO-003',version:'1'}});
  const state=fixture(),urlParams=new URLSearchParams({source:'quote',id:'Q-DEMO-003',version:'1'});
  assert.equal(resolveRecordView(state,urlParams).error,null);
});
