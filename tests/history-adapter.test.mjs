import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initialState,restoreState} from '../src/domain.mjs';
import {bindRevisionDraft,updateRevisionDraft} from '../src/quote-adapter.mjs';
import {historyModel,openHistoryRecord} from '../src/history-adapter.mjs';

const fixture=()=>restoreState(readFileSync(new URL('./fixtures/round9-review-before-case.json',import.meta.url),'utf8'));
const immutable=state=>Object.fromEntries(['rfqs','quotes','revisions','replies','draft','selected','unit','mode','interests','explorerDrafts','discovery'].map(key=>[key,state[key]]));

test('history lists every RFQ and quote version, with exact pending requests and truthful simulated reply status',()=>{
  const state=fixture(),before=structuredClone(state),model=historyModel(state);
  assert.deepEqual(model.counts,{rfqs:4,quotes:7,revisions:5,replies:3});
  assert.equal(model.groups.length,4);assert.equal(model.groups.flatMap(g=>g.quotes).length,7);
  assert.deepEqual(model.pending.map(r=>r.record.id),['REV-DEMO-001','REV-DEMO-004']);
  const pending=model.pending.find(r=>r.record.id==='REV-DEMO-004');
  assert.equal(pending.record.quoteId,'Q-DEMO-003');assert.equal(pending.record.quoteVersion,2);
  assert.equal(pending.replyStatus,'No simulated reply');assert.equal(pending.error,null);
  assert.equal(model.orphaned.length,0);assert.deepEqual(state,before);
});

test('reopening an older pending request restores its exact source quote without replacing the working inquiry',()=>{
  const state=fixture(),before=structuredClone(state),result=openHistoryRecord(state,{type:'revision',id:'REV-DEMO-004'});
  assert.equal(result.error,undefined);assert.equal(result.state.step,'revision');
  assert.equal(result.state.activeRfqId,'RFQ-DEMO-003');assert.equal(result.state.activeQuoteId,'Q-DEMO-003');
  assert.equal(result.state.activeQuoteVersion,2);assert.equal(result.state.activeRevisionId,'REV-DEMO-004');
  assert.deepEqual(immutable(result.state),immutable(before));assert.deepEqual(state,before);
  for(const key of ['rfqs','quotes','revisions','replies','draft'])assert.equal(result.state[key],state[key]);
});

test('RFQ, quote and reply entry points select exact identities and create no record',()=>{
  const state=fixture(),before=structuredClone(state);
  for(const [target,expected] of [
    [{type:'rfq',id:'RFQ-DEMO-001'},{step:'rfq',rfq:'RFQ-DEMO-001',quote:null,version:1,revision:null}],
    [{type:'quote',id:'Q-DEMO-002',version:1},{step:'quote',rfq:'RFQ-DEMO-002',quote:'Q-DEMO-002',version:1,revision:null}],
    [{type:'reply',id:'REPLY-DEMO-002'},{step:'response',rfq:'RFQ-DEMO-003',quote:'Q-DEMO-003',version:1,revision:'REV-DEMO-003'}]
  ]){
    const result=openHistoryRecord(state,target);assert.equal(result.error,undefined);
    assert.deepEqual({step:result.state.step,rfq:result.state.activeRfqId,quote:result.state.activeQuoteId,version:result.state.activeQuoteVersion,revision:result.state.activeRevisionId},expected);
    assert.deepEqual(immutable(result.state),immutable(before));assert.deepEqual(state,before);
  }
});

test('history switches retain per-version draft edits and leave request forms closed when opening saved requests',()=>{
  let state=bindRevisionDraft(fixture());
  const currentTarget={type:'quote',id:state.activeQuoteId,version:state.activeQuoteVersion};
  state=updateRevisionDraft(state,state.revisionDraftQuoteKey,{quantity:'777',message:'Unsubmitted question'});
  state.revisionEditingKey=state.revisionDraftQuoteKey;
  const opened=openHistoryRecord(state,{type:'revision',id:'REV-DEMO-004'}).state;
  assert.equal(opened.revisionEditingKey,undefined);
  assert.equal(opened.revisionDraftsByQuote[`${currentTarget.id}:v${currentTarget.version}`].quantity,'777');
  const rfqOnly=openHistoryRecord(opened,{type:'rfq',id:'RFQ-DEMO-001'}).state;
  assert.equal(rfqOnly.activeQuoteId,null);assert.equal(rfqOnly.activeRevisionId,null);
  assert.equal(rfqOnly.revisionDraftsByQuote[`${currentTarget.id}:v${currentTarget.version}`].message,'Unsubmitted question');
  const returned=openHistoryRecord(rfqOnly,currentTarget).state;
  assert.equal(returned.revisionDraft.quantity,'777');assert.equal(returned.revisionDraft.message,'Unsubmitted question');
  assert.deepEqual(immutable(returned),immutable(state));
});

test('missing, ambiguous and cross-linked histories are unavailable without falling back or mutating state',()=>{
  const cases=[
    [()=>{}, {type:'quote',id:'Q-DEMO-003',version:99}],
    [s=>s.rfqs.push(structuredClone(s.rfqs[0])),{type:'rfq',id:'RFQ-DEMO-001'}],
    [s=>{s.revisions.find(r=>r.id==='REV-DEMO-004').rfqId='RFQ-DEMO-004';},{type:'revision',id:'REV-DEMO-004'}],
    [s=>{s.quotes.find(q=>q.id==='Q-DEMO-003'&&q.version===2).rfqVersion=999;},{type:'quote',id:'Q-DEMO-003',version:2}],
    [s=>{s.quotes.find(q=>q.id==='Q-DEMO-003'&&q.version===2).revisionId='REV-DEMO-004';},{type:'quote',id:'Q-DEMO-003',version:2}],
    [s=>{s.replies.find(r=>r.id==='REPLY-DEMO-002').quoteVersion=2;},{type:'reply',id:'REPLY-DEMO-002'}],
    [s=>{s.replies.push(structuredClone(s.replies.find(r=>r.id==='REPLY-DEMO-002')));},{type:'reply',id:'REPLY-DEMO-002'}],
    [s=>{s.rfqs.find(r=>r.id==='RFQ-DEMO-003').caseId='OTHER';},{type:'revision',id:'REV-DEMO-004'}]
  ];
  for(const [mutate,target] of cases){const state=fixture();mutate(state);const before=structuredClone(state),result=openHistoryRecord(state,target);assert.ok(result.error);assert.equal(result.state,state);assert.deepEqual(state,before);}
});

test('unissued replies may be viewed without generating a quote, and orphan records remain listed as unavailable',()=>{
  const state=fixture();state.quotes=state.quotes.filter(q=>q.responseId!=='REPLY-DEMO-003');
  const before=structuredClone(state),result=openHistoryRecord(state,{type:'reply',id:'REPLY-DEMO-003'});
  assert.equal(result.error,undefined);assert.deepEqual(result.state.quotes,before.quotes);assert.deepEqual(state,before);
  state.rfqs=state.rfqs.filter(r=>r.id!=='RFQ-DEMO-003');
  const model=historyModel(state);assert.ok(model.orphaned.find(e=>e.record.id==='Q-DEMO-003'));
  assert.ok(model.orphaned.find(e=>e.record.id==='REV-DEMO-004'));
  assert.ok(model.orphaned.find(e=>e.record.id==='REPLY-DEMO-002'));
  assert.ok(model.orphaned.every(e=>e.error));
  assert.equal(historyModel(initialState()).groups.length,0);
});
