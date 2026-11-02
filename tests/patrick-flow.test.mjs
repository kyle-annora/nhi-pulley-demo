import test from 'node:test';
import assert from 'node:assert/strict';
import {PATRICK_KEY,PATRICK_QUESTION,PATRICK_STAGES,createPatrickSession,restorePatrickSession,patrickTransition,patrickView,preparedPatrickSession} from '../src/patrick-flow.mjs';

const NOW='2026-11-01T12:00:00.000Z';
function act(session,action,payload={}){const result=patrickTransition(session,action,payload,NOW);assert.ifError(result.error);return result.session;}
function until(target){let s=createPatrickSession();while(s.stage!==target)s=act(s,patrickView(s).action);return s;}
const records=s=>JSON.stringify({rfqs:s.state.rfqs,quotes:s.state.quotes,revisions:s.state.revisions,replies:s.state.replies,commercial:s.state.commercial});

test('new presentation uses an isolated key and viewing never manufactures saved records',()=>{
  assert.equal(PATRICK_KEY,'nhi-patrick-demo-v1');
  assert.ok(!['nhi-pulley-demo-v1','nhi-pulley-room-sample-v1','nhi-pulley-walkthrough-v1'].includes(PATRICK_KEY));
  const s=createPatrickSession(),before=structuredClone(s);
  assert.equal(s.state.caseId,'NHI-PATRICK-4412');assert.equal(s.state.draft.quantity,'200');assert.equal(s.state.draft.finish,'zinc');
  assert.equal(s.state.rfqs.length,0);assert.equal(s.state.quotes.length,0);assert.equal(s.state.draft.explorerRequirements,undefined);
  assert.equal(patrickView(s).role,'Presenter');assert.deepEqual(s,before);
  const inspection=act(s,'start'),question=act(inspection,'finish-inspection');
  assert.equal(question.stage,'question');assert.equal(question.state.rfqs.length,0);assert.equal(question.state.draft.explorerRequirements,undefined);assert.deepEqual(s,before);
});

test('full explicit buyer/seller route retains one question, inquiry and quote lineage',()=>{
  const s=until('complete'),state=s.state,question=state.draft.explorerRequirements[0];
  assert.equal(question.note,PATRICK_QUESTION);assert.equal(question.explorerContext.illustrative,true);
  assert.equal(state.rfqs.length,1);assert.equal(state.quotes.length,2);assert.equal(state.revisions.length,1);assert.equal(state.replies.length,1);
  const [v1,v2]=state.quotes,rfq=state.rfqs[0],revision=state.revisions[0],reply=state.replies[0];
  assert.equal(v1.requirements.quantity,'200');assert.equal(v1.totals.subtotalCents,175500);
  assert.equal(v2.requirements.quantity,'250');assert.equal(v2.totals.subtotalCents,226000);assert.equal(v2.totals.totalCents,null);
  assert.equal(v2.requirements.timing,'5 weeks from order');assert.match(v2.lead,/6–8 weeks/);
  assert.equal(v1.id,v2.id);assert.equal(v2.previousVersion,1);assert.equal(v2.rfqId,rfq.id);assert.equal(v2.revisionId,revision.id);assert.equal(v2.responseId,reply.id);
  for(const r of [rfq,v1,v2])assert.deepEqual(r.requirements.explorerRequirements[0],question);
  const plan=state.commercial.nextSteps[0],ack=state.commercial.acknowledgements[0];
  assert.equal(plan.quoteVersion,2);assert.deepEqual(plan.quoteSnapshot,v2);assert.equal(ack.requestId,plan.id);
  assert.ok(plan.reviewItems.some(i=>i.source?.requirementId===question.id&&i.unanswered));
});

test('reviews do not issue, and repeated or out-of-stage confirms never append a duplicate',()=>{
  let s=until('seller-v1');assert.equal(s.state.quotes.length,0);
  assert.ok(patrickTransition(s,'issue-v1',{},NOW).error);
  s=act(s,'review-v1');assert.equal(s.state.quotes.length,0);assert.equal(s.review.draft.quote.version,1);
  const issued=act(s,'issue-v1'),before=records(issued),duplicate=patrickTransition(issued,'issue-v1',{},NOW);
  assert.ok(duplicate.error);assert.equal(duplicate.session,issued);assert.equal(records(issued),before);
  const next=until('change-review');assert.equal(next.state.revisions.length,0);
  const changed=act(next,'save-change');assert.equal(changed.state.revisions.length,1);
  assert.ok(patrickTransition(changed,'save-change',{},NOW).error);assert.equal(changed.state.revisions.length,1);
  const v2Review=until('seller-review-v2');assert.equal(v2Review.state.quotes.length,1);assert.equal(v2Review.state.replies.length,0);
});

test('changed inquiry, change, seller draft and next-step contexts invalidate stale reviews without mutation',()=>{
  const cases=[
    ['inquiry-review','save-inquiry',s=>{s.state.draft.quantity='999';}],
    ['change-review','save-change',s=>{s.state.revisionDraft.quantity='999';}],
    ['seller-review-v1','issue-v1',s=>{s.state.commercial.drafts[s.review.key].sellerNote='Changed after review';}],
    ['plan-review','save-plan',s=>{s.planMessage='Changed plan';}],
    ['ack-review','confirm-ack',s=>{s.ackMessage='Changed acknowledgement';}]
  ];
  for(const [stage,action,mutate] of cases){const s=until(stage);mutate(s);const before=structuredClone(s),result=patrickTransition(s,action,{},NOW);assert.ok(result.error,stage);assert.equal(result.session,s);assert.deepEqual(s,before);}
});

test('editing a reviewed form preserves records, validates inputs and requires a fresh review',()=>{
  const s=until('inquiry-review'),before=records(s),editing=act(s,'edit-inquiry');
  assert.equal(editing.stage,'inquiry');assert.equal(editing.review,null);assert.equal(records(editing),before);
  const invalid=patrickTransition(editing,'review-inquiry',{quantity:'0'},NOW);assert.ok(invalid.errors.quantity);assert.equal(invalid.session,editing);
  const invalidQuestion=patrickTransition(until('question'),'save-question',{note:''},NOW);assert.ok(invalidQuestion.errors.note);
  const changed=act(editing,'update-inquiry',{fields:{quantity:'210',company:'Updated example',rfqs:'ignored'}});
  assert.equal(changed.state.draft.quantity,'210');assert.equal(changed.state.draft.rfqs,undefined);assert.equal(editing.state.draft.quantity,'200');
  assert.ok(patrickTransition(changed,'save-inquiry',{},NOW).error);
});

test('prepared checkpoints are deterministic copies of the same lineage and clearly labeled as prepared',()=>{
  const inquiry=preparedPatrickSession('inquiry'),v2=preparedPatrickSession('v2'),complete=preparedPatrickSession('complete');
  assert.equal(inquiry.stage,'inquiry-review');assert.equal(inquiry.state.rfqs.length,0);
  assert.equal(v2.stage,'quote-v2');assert.equal(v2.prepared,true);assert.equal(v2.state.quotes.length,2);
  assert.equal(complete.prepared,true);assert.equal(complete.state.commercial.acknowledgements.length,1);
  assert.deepEqual(v2.state.rfqs,complete.state.rfqs);assert.deepEqual(v2.state.quotes,complete.state.quotes);
  assert.deepEqual(v2,preparedPatrickSession('v2'));v2.state.quotes[0].requirements.quantity='mutated';assert.equal(preparedPatrickSession('v2').state.quotes[0].requirements.quantity,'200');
  assert.throws(()=>preparedPatrickSession('unknown'));
});

test('refresh restores stage and reviews while rejecting unrelated, malformed or incomplete case progress',()=>{
  for(const stage of PATRICK_STAGES.map(s=>s.id)){const s=until(stage);assert.deepEqual(restorePatrickSession(JSON.stringify(s)),s,stage);}
  const s=until('seller-review-v2'),missing=structuredClone(s);missing.review=null;assert.equal(restorePatrickSession(JSON.stringify(missing)),null);
  const unrelated=structuredClone(s);unrelated.state.caseId='DEMO-4412';assert.equal(restorePatrickSession(unrelated),null);
  const incomplete=createPatrickSession();incomplete.stage='complete';assert.equal(restorePatrickSession(incomplete),null);
  assert.equal(restorePatrickSession('{bad'),null);
});

test('short-route presentation metadata survives refresh without editing its prepared commercial records',()=>{
  const complete=preparedPatrickSession('complete'),before=records(complete);
  const short={...complete,presentationMode:'short',shortStep:2},restored=restorePatrickSession(JSON.stringify(short));
  assert.equal(restored.presentationMode,'short');assert.equal(restored.shortStep,2);assert.equal(records(restored),before);
  assert.equal(restorePatrickSession({...short,shortStep:4}),null);
  assert.equal(restorePatrickSession({...short,presentationMode:'unknown'}),null);
  assert.equal(restorePatrickSession({...createPatrickSession(),presentationMode:'short',shortStep:0}),null);
});
