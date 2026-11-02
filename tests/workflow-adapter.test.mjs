import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initialState,restoreState,saveRevision} from '../src/domain.mjs';
import {navigationState,replyContext,openReplyQuote,openReplyRevision} from '../src/workflow-adapter.mjs';

const fixture=()=>restoreState(readFileSync(new URL('./fixtures/round6-after-case.json',import.meta.url),'utf8'));
const replyCase=()=>({...fixture(),activeRfqId:'RFQ-DEMO-003',activeQuoteId:'Q-DEMO-003',activeQuoteVersion:2,activeRevisionId:'REV-DEMO-003',step:'response'});
const history=s=>structuredClone(Object.fromEntries(['rfqs','quotes','replies','revisions'].map(key=>[key,s[key]])));

test('navigation distinguishes current location, available routes and saved facts without creating completion or records',()=>{
  const state=initialState(),before=structuredClone(state);state.step='explore';
  let steps=navigationState(state);assert.equal(steps.find(x=>x.key==='explore').current,true);
  assert.equal(steps.find(x=>x.key==='select').detail,'F-4412');
  assert.equal(steps.find(x=>x.key==='configure').detail,'Working draft · not saved');
  assert.equal(steps.find(x=>x.key==='quote').available,false);assert.equal(steps.find(x=>x.key==='revision').available,false);
  assert.equal(steps.some(x=>'complete' in x),false);assert.deepEqual(history(state),history(before));
  const saved=fixture(),savedBefore=structuredClone(saved);saved.step='rfq';steps=navigationState(saved);
  assert.equal(steps.find(x=>x.key==='configure').current,true);assert.equal(steps.find(x=>x.key==='quote').available,true);
  assert.equal(steps.find(x=>x.key==='quote').detail,'Example quote not opened');assert.equal(steps.find(x=>x.key==='revision').available,false);
  saved.draft.quantity='300';assert.match(navigationState(saved).find(x=>x.key==='configure').detail,/Draft changed/);
  assert.deepEqual(history(saved),history(savedBefore));
  saved.step='components';assert.equal(navigationState(saved).some(x=>x.current),false);
});

test('reply context resolves the original quote from its linked v2 and leaves records and unresolved costs intact',()=>{
  const state=replyCase(),before=structuredClone(state),context=replyContext(state);
  assert.equal(context.error,undefined);assert.equal(context.base.version,1);assert.equal(context.issued.version,2);
  assert.equal(context.reply.id,'REPLY-DEMO-002');assert.equal(context.revision.id,'REV-DEMO-003');assert.equal(context.rfq.id,'RFQ-DEMO-003');
  assert.equal(context.subtotalCents,226000);assert.ok(context.pendingItems.includes('Freight'));
  assert.ok(context.pendingItems.includes('Applicable tax'));assert.equal(context.nextVersion,2);
  context.reply.requirements.quantity='900';context.base.product.id='changed';assert.deepEqual(state,before);
  const steps=navigationState(state);assert.equal(steps.find(x=>x.key==='revision').current,true);
  assert.equal(steps.find(x=>x.key==='revision').detail,'REPLY-DEMO-002 · simulated');
});

test('missing, stale or cross-linked response records are rejected without falling back to another saved reply',()=>{
  for(const mutate of [
    s=>{s.activeRevisionId='REV-MISSING';},
    s=>{s.activeRfqId='RFQ-DEMO-004';},
    s=>{s.activeQuoteId='Q-DEMO-002';},
    s=>{s.activeQuoteVersion=99;},
    s=>{s.replies[0].id='REPLY-DEMO-002';},
    s=>{s.replies=s.replies.filter(r=>r.id!=='REPLY-DEMO-002');},
    s=>{s.replies.find(r=>r.id==='REPLY-DEMO-002').quoteVersion=2;},
    s=>{s.replies.find(r=>r.id==='REPLY-DEMO-002').rfqId='RFQ-DEMO-002';},
    s=>{s.quotes.find(q=>q.id==='Q-DEMO-003'&&q.version===1).caseId='OTHER-CASE';},
    s=>{s.quotes.find(q=>q.id==='Q-DEMO-003'&&q.version===2).revisionId='REV-DEMO-004';},
    s=>{s.rfqs=s.rfqs.filter(r=>r.id!=='RFQ-DEMO-003');}
  ]){
    const state=replyCase();mutate(state);const before=structuredClone(state);
    assert.ok(replyContext(state).error);assert.ok(openReplyQuote(state,'REPLY-DEMO-002').error);
    assert.deepEqual(state,before);
  }
  const stale=fixture();assert.ok(replyContext(stale).error);
});

test('fallback selection stays on the active quote version and does not borrow an older reply',()=>{
  const state=replyCase();state.activeRevisionId=null;
  assert.match(replyContext(state).error,/No simulated reply/); // v2 request exists but has no reply.
  state.activeQuoteVersion=1;
  assert.equal(replyContext(state).reply.id,'REPLY-DEMO-002');
  const before=structuredClone(state);assert.ok(openReplyQuote(state,'REPLY-DEMO-001').error);
  assert.ok(openReplyRevision(state,'REV-DEMO-002').error);assert.deepEqual(state,before);
});

test('opening an existing revised quote or original request preserves every record and exact version linkage',()=>{
  const state=replyCase(),records=history(state),before=structuredClone(state);
  const opened=openReplyQuote(state,'REPLY-DEMO-002','2030-01-01T00:00:00Z');
  assert.equal(opened.quote.id,'Q-DEMO-003');assert.equal(opened.quote.version,2);
  assert.deepEqual(history(opened.state),records);assert.deepEqual(state,before);
  const reopened=openReplyQuote(opened.state,'REPLY-DEMO-002');assert.deepEqual(history(reopened.state),records);
  const revision=openReplyRevision(state,'REV-DEMO-003');
  assert.equal(revision.state.step,'revision');assert.equal(revision.state.activeQuoteVersion,1);
  assert.equal(revision.state.activeRfqId,'RFQ-DEMO-003');assert.deepEqual(history(revision.state),records);
});

test('unissued reply projection creates no record; explicit opening appends one version and remains deduplicated',()=>{
  const state=replyCase();state.activeQuoteVersion=1;state.quotes=state.quotes.filter(q=>q.responseId!=='REPLY-DEMO-002');
  const before=structuredClone(state),context=replyContext(state);
  assert.equal(context.issued,null);assert.equal(context.nextVersion,2);assert.equal(context.subtotalCents,226000);
  assert.deepEqual(state,before);
  const opened=openReplyQuote(state,'REPLY-DEMO-002','2026-11-01T18:00:00Z');
  assert.equal(opened.state.quotes.length,before.quotes.length+1);assert.deepEqual(opened.state.quotes.slice(0,-1),before.quotes);
  for(const key of ['rfqs','replies','revisions'])assert.deepEqual(opened.state[key],before[key]);
  assert.equal(opened.quote.previousVersion,1);assert.equal(opened.quote.responseId,'REPLY-DEMO-002');
  assert.equal(opened.quote.revisionId,'REV-DEMO-003');assert.equal(opened.quote.totals.totalCents,null);
  assert.deepEqual(history(openReplyQuote(opened.state,'REPLY-DEMO-002').state),history(opened.state));
});


test('response navigation names only the validated displayed reply and restores version-specific request status on other routes',()=>{
  const state=replyCase(),before=structuredClone(state);
  assert.equal(navigationState(state).find(x=>x.key==='revision').detail,'REPLY-DEMO-002 · simulated');
  state.step='quote';
  assert.equal(navigationState(state).find(x=>x.key==='revision').detail,'For v2 · 1 request · 1 without a reply');
  state.step='response';state.activeRevisionId='REV-DEMO-004';
  const unavailable=navigationState(state).find(x=>x.key==='revision');
  assert.equal(unavailable.current,true);assert.equal(unavailable.detail,'Reply unavailable · review context');
  assert.doesNotMatch(unavailable.detail,/REPLY-DEMO-002/);
  assert.deepEqual(history(state),history(before));
});


test('request navigation names the viewed quote version instead of hiding earlier revision history',()=>{
  const state=replyCase();state.step='quote';
  state.revisions=state.revisions.filter(r=>r.id!=='REV-DEMO-004');
  const before=structuredClone(state);
  assert.equal(navigationState(state).find(x=>x.key==='revision').detail,'No request for v2');
  state.activeQuoteVersion=1;
  assert.equal(navigationState(state).find(x=>x.key==='revision').detail,'For v1 · 1 request · simulated reply available');
  assert.deepEqual(history(state),history(before));
});


test('a new revision after acknowledgement takes priority in the journey and routes to the pending request without changing the old plan',()=>{
  const state=restoreState(readFileSync(new URL('./fixtures/round12-completed-sample-case.json',import.meta.url),'utf8'));
  state.activeRfqId='RFQ-DEMO-002';state.activeQuoteId='Q-DEMO-002';state.activeQuoteVersion=2;state.step='quote';
  const records=history(state),plans=structuredClone(state.commercial);
  state.revisionDraft={quantity:'300',timing:'',finish:'',message:'Please review the new demand before the engineering plan proceeds.'};
  const result=saveRevision(state,'2026-11-01T19:00:00Z');assert.equal(result.errors,undefined);
  const step=navigationState(result.state).find(x=>x.key==='revision');
  assert.equal(step.route,'revision');assert.match(step.detail,/new change.*awaiting seller reply/);assert.doesNotMatch(step.detail,/agreed/);
  assert.deepEqual(result.state.commercial,plans);assert.deepEqual(result.state.quotes,records.quotes);
  assert.deepEqual(result.state.revisions.slice(0,-1),records.revisions);
  result.state.activeQuoteVersion=1;
  assert.doesNotMatch(navigationState(result.state).find(x=>x.key==='revision').detail,/new change.*awaiting seller reply/);
});
