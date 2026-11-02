import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {activeRFQ,hasDraftChanges,initialState,restoreState} from '../src/domain.mjs';
import {inquiryDocument,saveReviewedInquiry,rfqStatus} from '../src/rfq-adapter.mjs';

const fixture=()=>restoreState(readFileSync(new URL('./fixtures/round5-before-case.json',import.meta.url),'utf8'));
const history=s=>structuredClone(Object.fromEntries(['rfqs','quotes','replies','revisions'].map(key=>[key,s[key]])));

test('saved inquiry and its downloadable attachments stay tied to the stored RFQ when the working product, units and requirements change',()=>{
  const state=fixture(),stored=structuredClone(activeRFQ(state)),records=history(state);
  state.selected='F-4414';state.unit='in';state.draft.quantity='450';state.draft.company='Different working company';
  state.draft.attachments[0].data='Changed draft attachment';
  state.draft.explorerRequirements=[];state.interests=[];
  assert.equal(hasDraftChanges(state),true);
  const packet=inquiryDocument(state,'saved');
  assert.deepEqual(packet,stored);
  assert.equal(packet.product.id,'F-4412');
  assert.equal(packet.requirements.quantity,'200');
  assert.ok(packet.requirements.attachments[0].data.startsWith('data:image/svg+xml;base64,'));
  packet.requirements.attachments[0].data='Presentation copy only';
  packet.requirements.explorerRequirements.length=0;
  assert.deepEqual(history(state),records);
  assert.deepEqual(inquiryDocument(state,'saved'),stored);
});

test('review is an isolated working copy and retains unresolved technical requirements without claiming a saved record',()=>{
  const state=fixture(),before=structuredClone(state),packet=inquiryDocument(state);
  assert.equal(packet.id,null);assert.equal(packet.createdAt,null);
  assert.deepEqual(packet.requirements,state.draft);
  assert.ok(packet.openItems.includes('Operating speed is unknown.'));
  assert.ok(packet.openItems.includes('Radial load is unknown.'));
  assert.ok(packet.openItems.includes('Requested finish needs feasibility and price review.'));
  packet.requirements.quantity='900';packet.requirements.attachments[0].data='Changed presentation';
  packet.product.width=99;packet.interests.length=0;packet.openItems.length=0;
  assert.deepEqual(state,before);
});

test('saving the reviewed existing request reopens its exact RFQ without adding or changing any historical records',()=>{
  const state=fixture(),before=structuredClone(state),packet=inquiryDocument(state);
  const result=saveReviewedInquiry(state,packet.fingerprint,'2030-01-01T00:00:00Z');
  assert.equal(result.duplicate,true);
  assert.equal(result.rfq.id,activeRFQ(before).id);
  assert.equal(result.rfq.createdAt,activeRFQ(before).createdAt);
  assert.equal(result.state.step,'rfq');
  assert.deepEqual(history(result.state),history(before));
  assert.deepEqual(state,before);
  assert.deepEqual(inquiryDocument(restoreState(JSON.stringify(result.state)),'saved'),activeRFQ(before));
});

test('an out-of-date review cannot save changed requirements or a different selected product',()=>{
  for(const change of [s=>{s.draft.quantity='250';},s=>{s.selected='F-4414';}]){
    const state=fixture(),reviewed=inquiryDocument(state);change(state);
    const before=structuredClone(state),result=saveReviewedInquiry(state,reviewed.fingerprint);
    assert.match(result.error,/draft changed/i);
    assert.strictEqual(result.state,state);assert.equal(result.rfq,undefined);
    assert.deepEqual(state,before);
  }
});

test('a current review with invalid required fields cannot create an RFQ or rewrite existing records',()=>{
  const state=fixture();state.draft.quantity='0';state.draft.email='invalid';state.draft.application='';
  const before=structuredClone(state),result=saveReviewedInquiry(state,inquiryDocument(state).fingerprint);
  for(const key of ['quantity','email','application'])assert.ok(result.errors[key]);
  assert.strictEqual(result.state,state);assert.equal(result.rfq,undefined);
  assert.deepEqual(state,before);
});

test('saving a changed reviewed inquiry appends one immutable snapshot, preserves every earlier record and does not invent a quote',()=>{
  const state=fixture();state.draft.quantity='325';state.draft.timing='7 weeks from order';
  const before=structuredClone(state),reviewed=inquiryDocument(state),now='2026-11-01T18:00:00Z';
  const result=saveReviewedInquiry(state,reviewed.fingerprint,now),saved=structuredClone(result.rfq);
  assert.equal(result.state.rfqs.length,before.rfqs.length+1);
  assert.deepEqual(result.state.rfqs.slice(0,-1),before.rfqs);
  for(const key of ['quotes','replies','revisions'])assert.deepEqual(result.state[key],before[key]);
  assert.equal(result.state.activeQuoteId,null);
  assert.equal(result.rfq.createdAt,now);
  assert.deepEqual(result.rfq.requirements,reviewed.requirements);
  assert.deepEqual(result.rfq.product,reviewed.product);
  assert.deepEqual(result.rfq.openItems,reviewed.openItems);
  assert.deepEqual(state,before);
  result.state.draft.quantity='450';result.state.draft.attachments[0].data='Later working edit';
  result.state.draft.explorerRequirements=[];
  assert.deepEqual(inquiryDocument(result.state,'saved'),saved);
});

test('empty saved view and unavailable browser storage never present a persisted or sent request',()=>{
  assert.equal(inquiryDocument(initialState(),'saved'),null);
  const status=rfqStatus({persistent:false,draftChanged:true,duplicate:true});
  assert.equal(status.kind,'error');
  assert.match(status.title,/session only/i);
  assert.doesNotMatch(status.title,/saved in this browser/i);
  assert.match(status.detail,/Export the case before leaving/);
  assert.match(status.detail,/no request has been sent to NHI/i);
  assert.equal(status.draftChanged,true);
  assert.match(status.duplicate,/existing record has been reopened/);
  const persisted=rfqStatus();
  assert.match(persisted.detail,/No request has been sent to NHI/);
  assert.equal(persisted.duplicate,'');
});
