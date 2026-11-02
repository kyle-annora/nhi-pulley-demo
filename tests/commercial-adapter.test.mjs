import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initialState,saveRFQ,saveRevision,activeQuote,restoreState} from '../src/domain.mjs';
import {sellerEntryState,commercialContext,saveSellerDraft,reviewSellerDraft,issueSellerDraft,recordSellerReply,requestNextStep,acknowledgeNextStep} from '../src/commercial-adapter.mjs';

const NOW='2026-11-01T12:00:00.000Z';
const records=s=>structuredClone(Object.fromEntries(['rfqs','quotes','revisions','replies','draft','revisionDraft'].map(k=>[k,s[k]])));
const inquiry=()=>saveRFQ(initialState(),NOW).state;
function issue(s,options={}){
  const saved=saveSellerDraft(s,options,NOW);assert.equal(saved.error,undefined);
  const review=reviewSellerDraft(saved.state,saved.draft.key);assert.equal(review.error,undefined);
  const result=issueSellerDraft(saved.state,review,NOW);assert.equal(result.error,undefined);return {...result,review};
}
function revision(s,quantity='250'){
  return saveRevision({...s,revisionDraft:{quantity,timing:'5 weeks',finish:'zinc',message:'Please review outdoor finish, mounting and load.'}},NOW).state;
}

test('seller preparation and review are private projections; explicit issue appends v1 without altering inquiry or working drafts',()=>{
  const s=inquiry(),before=structuredClone(s),saved=saveSellerDraft(s,{sellerNote:'Confirm mounting information before manufacturing.'},NOW);
  assert.deepEqual(s,before);assert.deepEqual(records(saved.state),records(before));
  assert.equal(saved.draft.quote.version,1);assert.equal(saved.draft.quote.totals.totalCents,null);assert.equal(saved.draft.reply,null);
  const context=commercialContext(saved.state);assert.equal(context.latestQuote,null);assert.equal(context.nextActor,'Seller');assert.equal(context.draft.key,saved.draft.key);
  const review=reviewSellerDraft(saved.state,saved.draft.key),snapshot=structuredClone(saved.state);
  review.draft.quote.requirements.quantity='999';assert.deepEqual(saved.state,snapshot);
  const issued=issueSellerDraft(saved.state,review,NOW);
  assert.equal(issued.quote.requirements.quantity,'200');assert.equal(issued.quote.sellerNote,'Confirm mounting information before manufacturing.');
  assert.equal(issued.state.quotes.length,1);assert.equal(issued.state.activeQuoteVersion,1);assert.equal(issued.state.activeRfqId,s.activeRfqId);
  for(const key of ['rfqs','replies','revisions','draft','revisionDraft'])assert.deepEqual(issued.state[key],s[key]);
  assert.deepEqual(saved.state,snapshot);assert.equal(commercialContext(issued.state).nextActor,'Buyer');
  const twice=issueSellerDraft(issued.state,review,'2030-01-01T00:00:00.000Z');assert.equal(twice.duplicate,true);assert.deepEqual(twice.state,issued.state);
});

test('seller v2 review carries per-item decisions and unresolved questions, then atomically appends reply and quote',()=>{
  const first=issue(inquiry()).state,s=revision(first),before=structuredClone(s),rev=s.revisions.at(-1);
  const saved=saveSellerDraft(s,{rfqId:s.activeRfqId,revisionId:rev.id},NOW);
  assert.equal(saved.error,undefined);assert.deepEqual(records(saved.state),records(before));
  assert.equal(saved.draft.quote.version,2);assert.equal(saved.draft.reply.decisions.length,3);
  assert.equal(saved.draft.reply.tasks.find(t=>t.title==='Customer question').unanswered,true);
  assert.equal(saved.draft.quote.requirements.quantity,'250');assert.equal(saved.draft.quote.totals.subtotalCents,226000);assert.equal(saved.draft.quote.totals.totalCents,null);
  const result=issueSellerDraft(saved.state,reviewSellerDraft(saved.state,saved.draft.key),NOW);
  assert.equal(result.state.quotes.length,2);assert.equal(result.state.replies.length,1);assert.deepEqual(result.state.quotes[0],before.quotes[0]);
  assert.equal(result.quote.responseId,result.reply.id);assert.equal(result.quote.revisionId,rev.id);assert.equal(result.quote.previousVersion,1);
  assert.equal(result.state.activeRevisionId,rev.id);assert.equal(result.state.activeQuoteVersion,2);
  for(const key of ['rfqs','revisions','draft','revisionDraft'])assert.deepEqual(result.state[key],before[key]);
  assert.deepEqual(s,before);
});

test('an explanation alone leaves the issued quote unchanged and can be reused by a reviewed v2',()=>{
  const s=revision(issue(inquiry()).state),before=structuredClone(s),rev=s.revisions.at(-1);
  const replied=recordSellerReply(s,rev.id,NOW);assert.equal(replied.error,undefined);assert.equal(replied.state.replies.length,1);
  assert.deepEqual(replied.state.quotes,before.quotes);assert.deepEqual(s,before);
  const duplicate=recordSellerReply(replied.state,rev.id);assert.equal(duplicate.duplicate,true);assert.deepEqual(duplicate.state,replied.state);
  const context=commercialContext(replied.state,{revisionId:rev.id});assert.equal(context.nextActor,'Seller');assert.equal(context.pendingRevisions.length,1);
  const issued=issue(replied.state,{revisionId:rev.id});assert.equal(issued.state.replies.length,1);assert.deepEqual(issued.state.replies[0],replied.reply);
  assert.equal(issued.state.quotes.length,2);
});

test('changed drafts and source records invalidate a review and issue does not write anything',()=>{
  const s=inquiry(),saved=saveSellerDraft(s,{},NOW),review=reviewSellerDraft(saved.state,saved.draft.key);
  const edited=saveSellerDraft(saved.state,{sellerNote:'Changed after review'},NOW).state,before=structuredClone(edited);
  assert.match(issueSellerDraft(edited,review).error,/changed after review/);assert.deepEqual(edited,before);
  const changed=structuredClone(saved.state);changed.rfqs[0].requirements.quantity='300';
  assert.match(issueSellerDraft(changed,review).error,/source records changed/i);assert.equal(changed.quotes.length,0);
  assert.match(issueSellerDraft(saved.state,{}).error,/Review/);
  const other=saveRFQ({...saved.state,draft:{...saved.state.draft,quantity:'400'}},NOW).state;
  const otherIssued=issue(other).state;
  assert.match(issueSellerDraft(otherIssued,review).error,/source records changed/i);
});

test('a competing v2 makes an older request read-only and cannot append a branch quotation',()=>{
  let s=revision(issue(inquiry()).state),request1=s.revisions[0];
  s=revision(s,'300');const request2=s.revisions[1];
  const draft2=saveSellerDraft(s,{revisionId:request2.id},NOW),review2=reviewSellerDraft(draft2.state,draft2.draft.key);
  const firstIssued=issue(draft2.state,{revisionId:request1.id}).state,before=structuredClone(firstIssued);
  assert.match(issueSellerDraft(firstIssued,review2).error,/older quote/);
  assert.match(saveSellerDraft(firstIssued,{revisionId:request2.id}).error,/older quote/);
  assert.match(recordSellerReply(firstIssued,request2.id).error,/older quote/);
  assert.deepEqual(firstIssued,before);assert.equal(firstIssued.quotes.length,2);
});

test('next-step request and seller acknowledgement bind the latest exact quote, retain open questions and deduplicate',()=>{
  const first=issue(inquiry()).state,changed=revision(first),s=issue(changed,{revisionId:changed.activeRevisionId}).state;
  const before=structuredClone(s),quote=activeQuote(s),request=requestNextStep(s,{quoteId:quote.id,quoteVersion:quote.version,message:'Review mounting drawing, speed and radial load.'},NOW);
  assert.equal(request.error,undefined);assert.deepEqual(records(request.state),records(before));assert.deepEqual(s,before);
  assert.equal(request.nextStep.quoteVersion,2);assert.equal(request.nextStep.openQuestions.find(t=>t.title==='Customer question').unanswered,true);
  assert.equal(commercialContext(request.state).nextActor,'Seller');assert.match(commercialContext(request.state).status,/awaiting seller/);
  const duplicate=requestNextStep(request.state,{quoteId:quote.id,quoteVersion:quote.version,message:'Same next step'});assert.equal(duplicate.duplicate,true);assert.deepEqual(duplicate.state,request.state);
  const ack=acknowledgeNextStep(request.state,{requestId:request.nextStep.id,message:'We will review the drawing and identify the operating data needed.'},NOW);
  assert.equal(ack.error,undefined);assert.equal(commercialContext(ack.state).status,'Review request acknowledged · customer information needed');assert.match(ack.acknowledgement.boundary,/not order acceptance/);
  assert.deepEqual(records(ack.state),records(before));assert.equal(ack.state.commercial.nextSteps[0].openQuestions.find(t=>t.title==='Customer question').unanswered,true);
  const again=acknowledgeNextStep(ack.state,{requestId:request.nextStep.id,message:'Repeated'});assert.equal(again.duplicate,true);assert.deepEqual(again.state,ack.state);
});

test('old-quote next actions and cross-linked or modified request snapshots are rejected',()=>{
  const first=issue(inquiry()).state,quote=activeQuote(first);
  assert.match(requestNextStep(first,{quoteId:quote.id,quoteVersion:quote.version,message:''}).error,/Describe/);
  assert.match(requestNextStep(first,{quoteId:quote.id,quoteVersion:quote.version,kind:'order',message:'Buy'}).error,/engineering-review/);
  const requested=requestNextStep(first,{quoteId:quote.id,quoteVersion:quote.version,message:'Engineering discussion'},NOW).state;
  const changed=revision(requested),revised=issue(changed,{revisionId:changed.activeRevisionId}).state;
  assert.match(requestNextStep(revised,{quoteId:quote.id,quoteVersion:1,message:'Review'}).error,/earlier quote/);
  assert.match(acknowledgeNextStep(revised,{requestId:requested.commercial.nextSteps[0].id,message:'Confirmed'}).error,/earlier quote/);
  for(const mutate of [s=>s.commercial.nextSteps[0].rfqId='WRONG',s=>s.commercial.nextSteps[0].quoteSnapshot.requirements.quantity='999']){
    const broken=structuredClone(requested);mutate(broken);const before=structuredClone(broken);
    assert.match(acknowledgeNextStep(broken,{requestId:broken.commercial.nextSteps[0].id,message:'Confirmed'}).error,/does not match/);assert.deepEqual(broken,before);
  }
});

test('legacy browser fixtures gain commercial context and next-step records without changing saved history or drafts',()=>{
  const s=restoreState(readFileSync(new URL('./fixtures/round10-after-case.json',import.meta.url),'utf8'));
  assert.ok(s);const before=structuredClone(s),quote=s.quotes.find(q=>q.id==='Q-DEMO-004'&&q.version===2);
  const context=commercialContext(s,{rfqId:quote.rfqId});assert.equal(context.latestQuote.version,2);assert.equal(context.nextActor,'Buyer');
  const next=requestNextStep(s,{quoteId:quote.id,quoteVersion:2,message:'Please review the outstanding engineering questions.'},NOW);
  assert.equal(next.error,undefined);assert.deepEqual(records(next.state),records(before));assert.deepEqual(s,before);
  const rejected=saveSellerDraft(s,{rfqId:quote.rfqId});assert.match(rejected.error,/already has an issued quote/);assert.deepEqual(s,before);
});


test('general seller entry selects the latest quote while explicit requests retain their source version and per-version drafts',()=>{
  const first=issue(inquiry()).state,changed=revision(first),s=issue(changed,{revisionId:changed.activeRevisionId}).state;
  const before=structuredClone(s),old=s.quotes[0];
  const viewing={...s,activeQuoteVersion:1,revisionDraftQuoteKey:`${old.id}:v1`,revisionDraft:{quantity:'333',timing:'',finish:'',message:'Unsaved older-version note'}};
  const latest=sellerEntryState(viewing);assert.equal(latest.error,undefined);assert.equal(latest.state.activeQuoteVersion,2);assert.equal(latest.state.sellerRevisionId,null);
  assert.equal(latest.state.revisionDraftsByQuote[`${old.id}:v1`].message,'Unsaved older-version note');
  const explicit=sellerEntryState(latest.state,s.revisions[0].id);assert.equal(explicit.state.activeQuoteVersion,1);assert.equal(explicit.state.activeRevisionId,s.revisions[0].id);assert.equal(explicit.state.sellerRevisionId,s.revisions[0].id);
  assert.equal(explicit.state.revisionDraft.message,'Unsaved older-version note');
  for(const key of ['rfqs','quotes','revisions','replies'])assert.deepEqual(explicit.state[key],before[key]);
  assert.deepEqual(s,before);assert.match(sellerEntryState(s,'MISSING').error,/unavailable/);
});
