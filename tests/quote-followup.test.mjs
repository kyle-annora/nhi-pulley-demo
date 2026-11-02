import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initialState,saveRFQ,saveRevision,activeQuote,restoreState} from '../src/domain.mjs';
import {saveSellerDraft,reviewSellerDraft,issueSellerDraft,recordSellerReply,requestNextStep,acknowledgeNextStep} from '../src/commercial-adapter.mjs';
import {quoteFollowup} from '../src/quote-followup.mjs';

const NOW='2026-11-01T12:00:00.000Z';
function issue(state,revisionId){
  const saved=saveSellerDraft(state,{revisionId},NOW);assert.ifError(saved.error);
  const result=issueSellerDraft(saved.state,reviewSellerDraft(saved.state,saved.draft.key),NOW);assert.ifError(result.error);
  return result.state;
}
const first=()=>issue(saveRFQ(initialState(),NOW).state);
function change(state,quantity='250'){
  return saveRevision({...state,revisionDraft:{quantity,timing:'5 weeks',finish:'',message:'Please review the requested quantity and timing.'}},NOW).state;
}
function planned(){
  let state=first(),q=activeQuote(state);
  const request=requestNextStep(state,{quoteId:q.id,quoteVersion:q.version,message:'Please review the saved mounting question.'},NOW);assert.ifError(request.error);
  state=acknowledgeNextStep(request.state,{requestId:request.nextStep.id,message:'The review plan is acknowledged.'},NOW).state;
  return state;
}

test('a new commercial change owns the wait ahead of an earlier acknowledged review plan',()=>{
  const state=change(planned(),'300'),before=structuredClone(state),view=quoteFollowup(state,activeQuote(state));
  assert.equal(view.status,'Waiting for seller reply');assert.equal(view.waiting,true);
  assert.equal(view.ack.message,'The review plan is acknowledged.');assert.equal(view.pending.length,1);
  assert.match(view.customerGuidance,/No action needed from you on this change right now/);
  assert.equal(view.technicalLabel,'Separate technical question · Engineering review open');
  assert.deepEqual(state,before);
  view.pending[0].message='UI changed this copy';view.ack.message='UI changed this copy';
  assert.deepEqual(state,before);
});

test('a recorded reply without an issued revision waits for the revised proposal',()=>{
  const changed=change(first()),reply=recordSellerReply(changed,changed.revisions.at(-1).id,NOW);assert.ifError(reply.error);
  const view=quoteFollowup(reply.state,activeQuote(reply.state));
  assert.equal(view.status,'Waiting for revised proposal');assert.equal(view.waiting,true);
  assert.match(view.customerGuidance,/seller’s revised proposal/);
  assert.equal(reply.state.quotes.length,1);
});

test('a requested review waits for seller acknowledgement, then for findings without implying active engineering work',()=>{
  const state=first(),q=activeQuote(state);
  const requested=requestNextStep(state,{quoteId:q.id,quoteVersion:q.version,message:'Please review mounting.'},NOW).state;
  const waiting=quoteFollowup(requested,q);
  assert.equal(waiting.status,'Waiting for seller acknowledgement');assert.equal(waiting.waiting,true);
  assert.match(waiting.customerGuidance,/on this review plan/);
  const acknowledged=planned(),findings=quoteFollowup(acknowledged,activeQuote(acknowledged));
  assert.equal(findings.status,'Awaiting engineering findings');
  assert.match(findings.next,/remain unconfirmed/);assert.doesNotMatch(findings.next,/in progress|approved/i);
});

test('read-only historical quotes do not inherit no-action guidance from current pending work',()=>{
  let state=change(first());state=issue(state,state.revisions.at(-1).id);state=change(state,'300');
  const q=state.quotes.find(q=>q.version===1),view=quoteFollowup(state,q);
  assert.equal(view.archived,true);assert.equal(view.latest.version,2);assert.equal(view.waiting,false);
  assert.deepEqual(view.pending,[]);assert.equal(view.customerGuidance,'');assert.equal(view.actionLabel,'Open latest quote v2');
});

test('the displayed quote resolves its own RFQ even while another RFQ is active',()=>{
  const state=restoreState(readFileSync(new URL('./fixtures/round23-before-sample-case.json',import.meta.url),'utf8'));
  const q=state.quotes.find(q=>q.id==='Q-DEMO-002'&&q.version===2),before=structuredClone(state),view=quoteFollowup(state,q);
  assert.equal(state.activeRfqId,'RFQ-DEMO-003');assert.equal(view.rfq.id,'RFQ-DEMO-002');
  assert.equal(view.latest.id,'Q-DEMO-002');assert.equal(view.pending.length,0);
  assert.deepEqual(state,before);
});

test('a proposal ready for buyer review is not labeled as requiring no action',()=>{
  const state=first(),view=quoteFollowup(state,activeQuote(state));
  assert.equal(view.status,'Proposal ready for your review');assert.equal(view.waiting,false);
  assert.equal(view.customerGuidance,'');assert.equal(view.actionLabel,'Request engineering review');
});
