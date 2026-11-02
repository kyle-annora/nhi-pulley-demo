import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initialState,restoreState} from '../src/domain.mjs';
import {inquiryDraftContext} from '../src/inquiry-context.mjs';

const fixture=()=>restoreState(readFileSync(new URL('./fixtures/round17-before-sample-case.json',import.meta.url),'utf8'));
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

test('working draft, saved inquiry, quote v2 and pending request retain their distinct quantities',()=>{
  const state=freeze(fixture()),before=JSON.stringify(state),context=inquiryDraftContext(state);
  assert.equal(state.draft.quantity,'200');
  assert.equal(context.rfq.id,'RFQ-DEMO-003');
  assert.equal(context.rfq.requirements.quantity,'200');
  assert.equal(context.quote.version,2);
  assert.equal(context.quote.requirements.quantity,'250');
  assert.deepEqual(context.pending.map(r=>r.id),['REV-DEMO-004']);
  assert.equal(context.pending[0].changes.find(c=>c.field==='quantity').after,'300');
  assert.equal(context.changed,false);
  assert.equal(JSON.stringify(state),before);
});

test('editing the inquiry draft reports a difference without updating saved records or pending work',()=>{
  const state=fixture(),before=JSON.stringify([state.rfqs,state.quotes,state.revisions,state.replies]);
  state.draft.quantity='400';
  const context=inquiryDraftContext(state);
  assert.equal(context.changed,true);
  assert.equal(context.rfq.requirements.quantity,'200');
  assert.equal(context.quote.requirements.quantity,'250');
  assert.equal(JSON.stringify([state.rfqs,state.quotes,state.revisions,state.replies]),before);
});

test('an archived or unrelated active quote cannot replace the latest quote for the active inquiry',()=>{
  const state=fixture();
  state.activeQuoteVersion=1;
  assert.equal(inquiryDraftContext(state).quote.version,2);
  state.activeQuoteId='Q-DEMO-001';
  const context=inquiryDraftContext(state);
  assert.equal(context.quote.id,'Q-DEMO-003');
  assert.equal(context.quote.version,2);
  state.activeRfqId='RFQ-DEMO-002';
  const earlier=inquiryDraftContext(state);
  assert.equal(earlier.quote.id,'Q-DEMO-002');
  assert.deepEqual(earlier.pending,[]);
});

test('a new inquiry or different selected product has no implied saved quote relationship',()=>{
  const empty={rfq:null,quote:null,pending:[],changed:false};
  assert.deepEqual(inquiryDraftContext(initialState()),empty);
  const state=fixture();
  state.selected='F-4414';
  assert.deepEqual(inquiryDraftContext(state),empty);
  state.selected='F-4412';state.activeRfqId='missing';
  assert.deepEqual(inquiryDraftContext(state),empty);
});

test('ambiguous or broken source associations do not offer an unrelated quote shortcut',()=>{
  const state=fixture();
  state.quotes.find(q=>q.id==='Q-DEMO-003'&&q.version===2).product.id='F-4414';
  const context=inquiryDraftContext(state);
  assert.equal(context.rfq.id,'RFQ-DEMO-003');
  assert.equal(context.quote,null);
  assert.deepEqual(context.pending,[]);
  state.rfqs.push(structuredClone(context.rfq));
  assert.equal(inquiryDraftContext(state).rfq,null);
});
