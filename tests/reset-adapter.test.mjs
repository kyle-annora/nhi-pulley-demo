import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initialState,restoreState} from '../src/domain.mjs';
import {createResetReview,resetReviewedDemo} from '../src/reset-adapter.mjs';

const fixture=()=>restoreState(readFileSync(new URL('./fixtures/round7-after-case.json',import.meta.url),'utf8'));

test('opening reset review gives an immutable exact summary without modifying the existing case',()=>{
  const state=fixture(),before=structuredClone(state),review=createResetReview(state);
  assert.deepEqual(review.counts,{rfqs:4,nextSteps:0,acknowledgements:0,quoteVersions:7,replies:3,revisions:5,draftFiles:1,explorerInputs:2});
  assert.equal(review.caseId,state.caseId);assert.equal(review.selected,'F-4412');
  assert.ok(Object.isFrozen(review));assert.ok(Object.isFrozen(review.counts));
  assert.throws(()=>{review.counts.rfqs=0;},TypeError);
  assert.deepEqual(JSON.parse(review.fingerprint),before);assert.deepEqual(state,before);
  state.draft.quantity='999';assert.equal(JSON.parse(review.fingerprint).draft.quantity,before.draft.quantity);
});

test('absence of explicit acknowledgement cannot write or clear any data',()=>{
  const state=fixture(),before=structuredClone(state),review=createResetReview(state);let writes=0;
  for(const acknowledgement of [false,undefined,null,'true',1]){
    const result=resetReviewedDemo(state,review,acknowledgement,()=>{writes++;});
    assert.equal(result.state,state);assert.equal(result.code,'acknowledgement-required');
    assert.equal(result.reset,undefined);assert.ok(result.error);
  }
  assert.equal(writes,0);assert.deepEqual(state,before);
});

test('a changed draft or record invalidates confirmation even when counts are unchanged',()=>{
  for(const change of [
    s=>{s.draft.notes+=' A new requirement.';},
    s=>{s.draft.attachments[0].data+='changed';},
    s=>{s.quotes[0].requirements.quantity='999';},
    s=>{s.replies[0].tasks[0].detail='Updated question';},
    s=>{s.revisionDraft.message='New unsaved request';},
    s=>{s.activeQuoteVersion=1;}
  ]){
    const state=fixture(),review=createResetReview(state);change(state);const before=structuredClone(state);let writes=0;
    const result=resetReviewedDemo(state,review,true,()=>{writes++;});
    assert.equal(result.state,state);assert.equal(result.code,'stale-review');assert.equal(result.stale,true);
    assert.equal(writes,0);assert.deepEqual(state,before);
  }
  const state=fixture();assert.equal(resetReviewedDemo(state,null,true,()=>assert.fail('Must not write')).code,'stale-review');
});

test('failed browser persistence retains the whole current case and allows a later explicit retry',()=>{
  const state=fixture(),before=structuredClone(state),review=createResetReview(state);let stored=JSON.stringify(state);
  const fail=resetReviewedDemo(state,review,true,()=>{throw new Error('QuotaExceededError');});
  assert.equal(fail.state,state);assert.equal(fail.code,'storage-unavailable');assert.match(fail.error,/Nothing was reset/);
  assert.deepEqual(state,before);assert.deepEqual(JSON.parse(stored),before);
  for(const writer of [undefined,()=>false])assert.equal(resetReviewedDemo(state,review,true,writer).code,'storage-unavailable');
  const retry=resetReviewedDemo(state,review,true,snapshot=>{stored=snapshot;});
  assert.equal(retry.reset,true);assert.deepEqual(retry.state,initialState());
  assert.deepEqual(JSON.parse(stored),retry.state);assert.deepEqual(state,before);
});

test('confirmed reset writes only the replacement demo snapshot before returning fresh state',()=>{
  const state=fixture(),before=structuredClone(state),review=createResetReview(state);
  const storage=new Map([['demo',JSON.stringify(state)],['unrelated','retain this']]);let writes=0;
  const result=resetReviewedDemo(state,review,true,snapshot=>{
    writes++;assert.deepEqual(state,before);assert.deepEqual(JSON.parse(snapshot),initialState());
    storage.set('demo',snapshot);
  });
  assert.equal(writes,1);assert.equal(result.reset,true);assert.equal(result.error,undefined);
  assert.notEqual(result.state,state);assert.deepEqual(result.state,initialState());
  assert.deepEqual(JSON.parse(storage.get('demo')),result.state);assert.equal(storage.get('unrelated'),'retain this');
  assert.deepEqual(state,before);
  const stale=resetReviewedDemo(result.state,review,true,()=>assert.fail('An old review cannot reset a new case'));
  assert.equal(stale.code,'stale-review');assert.equal(stale.state,result.state);
});
