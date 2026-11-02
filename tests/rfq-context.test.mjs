import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initialState,restoreState,saveRFQ} from '../src/domain.mjs';
import {inquiryDocument} from '../src/rfq-adapter.mjs';
import {rfqViewContext} from '../src/rfq-context.mjs';

const fixture=()=>restoreState(readFileSync(new URL('./fixtures/round17-before-sample-case.json',import.meta.url),'utf8'));
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

test('saved RFQ, working draft, latest quote and pending change keep their own values and responsibilities',()=>{
  const state=fixture(),packet=inquiryDocument(state,'saved');
  state.draft.quantity='400';state.draft.speed='1500';state.draft.load='80';state.draft.explorerRequirements=[];
  state.quotes.at(-1).reviewItems=[];
  freeze(state);freeze(packet);
  const before=JSON.stringify(state),context=rfqViewContext(state,packet);
  assert.equal(packet.requirements.quantity,'200');
  assert.equal(state.draft.quantity,'400');
  assert.equal(context.quote.requirements.quantity,'250');
  assert.equal(context.pending[0].changes.find(c=>c.field==='quantity').after,'300');
  assert.equal(context.draftChanged,true);assert.equal(context.isCurrentProduct,true);
  assert.deepEqual(context.customerItems.map(i=>i.id),['application:speed','application:load','application:mounting-drawing']);
  assert.equal(context.engineeringItems.filter(i=>i.source.kind==='explorer').length,3);
  assert.equal(JSON.stringify(state),before);
  context.rfq.requirements.quantity='999';context.engineeringItems[0].detail='Presentation only';
  assert.equal(JSON.stringify(state),before);
});

test('an earlier saved RFQ opens its exact latest quote even while another product and quote are active',()=>{
  const state=fixture(),packet=structuredClone(state.rfqs[1]);
  state.selected='F-4414';
  const context=rfqViewContext(state,packet);
  assert.equal(context.rfq.id,'RFQ-DEMO-002');
  assert.equal(context.quote.id,'Q-DEMO-002');assert.equal(context.quote.version,2);
  assert.deepEqual(context.pending,[]);
  assert.equal(context.isCurrentProduct,false);assert.equal(context.draftChanged,true);
  assert.equal(context.error,null);
});

test('new and unquoted inquiries have no invented quote or pending change',()=>{
  const state=initialState(),draft=rfqViewContext(state,inquiryDocument(state));
  assert.equal(draft.rfq,null);assert.equal(draft.quote,null);assert.deepEqual(draft.pending,[]);
  assert.equal(draft.error,null);assert.equal(draft.draftChanged,false);
  const saved=saveRFQ(state,'2026-11-01T18:00:00Z').state,context=rfqViewContext(saved,inquiryDocument(saved,'saved'));
  assert.ok(context.rfq);assert.equal(context.quote,null);assert.deepEqual(context.pending,[]);
  assert.equal(context.error,null);assert.equal(context.draftChanged,false);
});

test('review draft links only its active same-product RFQ and keeps its own current question list',()=>{
  const state=fixture();state.activeQuoteId='Q-DEMO-001';state.draft.quantity='400';state.draft.speed='1500';
  const context=rfqViewContext(state,inquiryDocument(state));
  assert.equal(context.rfq.id,'RFQ-DEMO-003');assert.equal(context.quote.id,'Q-DEMO-003');
  assert.equal(context.draftChanged,true);
  assert.equal(context.customerItems.some(i=>i.id==='application:speed'),false);
  state.selected='F-4414';
  const different=rfqViewContext(state,inquiryDocument(state));
  assert.equal(different.rfq,null);assert.equal(different.quote,null);assert.deepEqual(different.pending,[]);
  assert.equal(different.error,null);
});

test('missing or inconsistent saved associations suppress quote and seller shortcuts',()=>{
  const state=fixture(),packet=inquiryDocument(state,'saved');
  state.rfqs=state.rfqs.filter(r=>r.id!==packet.id);
  let context=rfqViewContext(state,packet);
  assert.ok(context.error);assert.equal(context.rfq,null);assert.equal(context.quote,null);assert.deepEqual(context.pending,[]);
  const broken=fixture();broken.quotes.at(-1).product.id='F-4414';
  context=rfqViewContext(broken,inquiryDocument(broken,'saved'));
  assert.ok(context.error);assert.ok(context.rfq);assert.equal(context.quote,null);assert.deepEqual(context.pending,[]);
  const mismatched={...inquiryDocument(fixture(),'saved'),version:99};
  assert.ok(rfqViewContext(fixture(),mismatched).error);
});

test('retained owner assignments and legacy RFQ questions survive without borrowing quote-only work',()=>{
  const state=fixture(),packet=inquiryDocument(state,'saved');
  packet.reviewItems.push({id:'sales:retained',owner:'Sales',title:'Retained customer question',detail:'Please confirm packing.'});
  let context=rfqViewContext(state,packet);
  assert.deepEqual(context.otherItems.map(i=>i.id),['sales:retained']);
  assert.equal(context.otherItems.some(i=>i.id==='commercial:freight-tax'),false);
  delete packet.reviewItems;
  context=rfqViewContext(state,packet);
  assert.equal(context.engineeringItems.filter(i=>i.source.kind==='explorer').length,3);
  assert.equal(context.otherItems.some(i=>i.id==='commercial:freight-tax'),false);
});
