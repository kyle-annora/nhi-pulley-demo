import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initialState,saveRFQ,saveRevision,activeQuote,openItems} from '../src/domain.mjs';
import {saveExplorerInput} from '../src/inquiry-adapter.mjs';
import {reviewItemsFor,recordReviewItems,reviewHandoff} from '../src/review-items.mjs';
import {saveSellerDraft,reviewSellerDraft,issueSellerDraft,requestNextStep,acknowledgeNextStep,commercialContext} from '../src/commercial-adapter.mjs';
const NOW='2026-11-01T18:00:00.000Z';
const explorer=items=>items.filter(i=>i.source.kind==='explorer');
function issue(s,revisionId){const d=saveSellerDraft(s,{revisionId},NOW);assert.equal(d.error,undefined);const result=issueSellerDraft(d.state,reviewSellerDraft(d.state,d.draft.key),NOW);assert.equal(result.error,undefined);return result.state;}
function questioned(){let s=initialState();s=saveExplorerInput(s,'belt',{value:'',note:'Please compare the belt width with drawing B.'},true,NOW).state;s=saveExplorerInput(s,'flange',{value:'',note:'Please confirm outside clearance against the guard.'},true,NOW).state;s=saveExplorerInput(s,'mount',{value:'',note:'Does the offset in drawing M need a spacer?'},true,NOW).state;return s;}

test('explicit Explorer questions keep stable identity, original note and model source through RFQ, seller draft, v2 and next-step',()=>{
  const initial=questioned(),before=structuredClone(initial),expected=explorer(reviewItemsFor(initial.draft,{productId:initial.selected}));
  assert.equal(expected.length,3);assert.deepEqual(expected.map(i=>i.source.theme),['belt','flange','mount']);
  assert.ok(expected.every(i=>i.unanswered&&i.owner==='Engineering'&&i.source.explorerContext.modelId==='f4412'));
  assert.match(openItems(initial.draft).join(' '),/outside clearance/);
  let s=saveRFQ(initial,NOW).state;assert.deepEqual(explorer(s.rfqs[0].reviewItems),expected);
  s=issue(s);assert.deepEqual(explorer(activeQuote(s).reviewItems),expected);const old=structuredClone({rfqs:s.rfqs,quotes:s.quotes});
  s=saveRevision({...s,revisionDraft:{quantity:'250',timing:'5 weeks',finish:'zinc',message:'Please answer the three Explorer questions.'}},NOW).state;
  const draft=saveSellerDraft(s,{revisionId:s.activeRevisionId,sellerNote:'All customer questions are retained.'},NOW);
  assert.deepEqual(explorer(draft.draft.reply.tasks),expected);assert.deepEqual(explorer(draft.draft.quote.reviewItems),expected);
  s=issueSellerDraft(draft.state,reviewSellerDraft(draft.state,draft.draft.key),NOW).state;
  assert.deepEqual(explorer(s.replies[0].reviewItems),expected);assert.deepEqual(explorer(activeQuote(s).reviewItems),expected);
  const q=activeQuote(s),requested=requestNextStep(s,{quoteId:q.id,quoteVersion:q.version,message:'Review these retained questions.'},NOW);
  assert.deepEqual(explorer(requested.nextStep.openQuestions),expected);assert.deepEqual(explorer(requested.nextStep.reviewItems),expected);
  const acknowledged=acknowledgeNextStep(requested.state,{requestId:requested.nextStep.id,message:'Engineering will review each saved question.'},NOW);
  assert.ok(explorer(commercialContext(acknowledged.state).reviewItems).every(i=>i.unanswered));
  assert.deepEqual(s.rfqs,old.rfqs);assert.deepEqual(s.quotes[0],old.quotes[0]);assert.deepEqual(initial,before);
});

test('v1 engineering request includes current questions without requiring a simulated reply',()=>{
  let s=questioned();s=issue(saveRFQ(s,NOW).state);const q=activeQuote(s);
  const request=requestNextStep(s,{quoteId:q.id,quoteVersion:1,message:'Review the candidate.'},NOW);
  assert.equal(request.error,undefined);assert.equal(explorer(request.nextStep.openQuestions).length,3);
  assert.equal(request.state.replies.length,0);assert.ok(request.nextStep.openQuestions.some(i=>i.id==='application:speed'));
});

test('legacy projections recover missed review questions without changing any saved task, record or historical answer',()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/round12-completed-sample-case.json',import.meta.url),'utf8'));
  const old=fixture.commercial.nextSteps.at(-1),before=JSON.stringify(fixture);
  const projected=recordReviewItems(old);
  assert.ok(projected.every(i=>i.legacyProjection));assert.ok(projected.some(i=>i.source.kind==='explorer'&&i.source.theme==='mount'));
  assert.ok(projected.some(i=>i.title==='Customer question'));
  assert.equal(JSON.stringify(fixture),before);
  projected[0].detail='Changed UI copy';assert.equal(JSON.stringify(fixture),before);
});

test('handoff is derived from saved requirements, keeps owners distinct and does not invent an answer',()=>{
  const s=questioned();s.draft.speed='2400';s.draft.load='30';s.draft.finish='iron-phosphate';s.draft.attachments=[{name:'application.pdf'}];s.draft.mounting='Use existing mounting; dimensions attached';
  const items=reviewItemsFor(s.draft,{includeCommercial:true});const h=reviewHandoff(items);
  assert.equal(h.customer.length,0);assert.ok(!items.some(i=>['Operating speed','Radial load','Finish suitability'].includes(i.title)));
  assert.equal(h.sales[0].title,'Freight & tax');assert.ok(h.engineering.length>=3);assert.equal(h.nextActor,'Seller / engineering');
  assert.ok(items.every(i=>i.unanswered));assert.ok(!JSON.stringify(h).includes('zinc'));
});

test('a fresh change takes priority over a previous acknowledgement and blocks stale next-step confirmations',()=>{
  let s=issue(saveRFQ(questioned(),NOW).state),q=activeQuote(s);
  const requested=requestNextStep(s,{quoteId:q.id,quoteVersion:q.version,message:'Review this version.'},NOW);
  s=acknowledgeNextStep(requested.state,{requestId:requested.nextStep.id,message:'We will review it.'},NOW).state;
  const oldHistory=structuredClone(s.commercial);
  s=saveRevision({...s,revisionDraft:{quantity:'300',timing:'',finish:'',message:'Please update the quantity before continuing.'}},NOW).state;
  const context=commercialContext(s),before=structuredClone(s);
  assert.equal(context.pendingRevisions.length,1);assert.equal(context.nextActor,'Seller');assert.match(context.status,/New change request/);
  assert.match(requestNextStep(s,{quoteId:q.id,quoteVersion:q.version,message:'Confirm again.'}).error,/new change request/i);
  assert.match(acknowledgeNextStep(s,{requestId:requested.nextStep.id,message:'Confirm again.'}).error,/new change request/i);
  assert.deepEqual(s,before);assert.deepEqual(s.commercial,oldHistory);
  s=issue(s,s.activeRevisionId);q=activeQuote(s);assert.equal(q.version,2);assert.equal(commercialContext(s).pendingRevisions.length,0);
  assert.equal(commercialContext(s).acknowledgement,null);assert.deepEqual(s.commercial.acknowledgements,oldHistory.acknowledgements);
  const next=requestNextStep(s,{quoteId:q.id,quoteVersion:2,message:'Review the updated quantity.'},NOW);
  assert.equal(next.error,undefined);assert.equal(next.state.commercial.nextSteps.length,2);
});

test('illustrative attachments do not remove the customer mounting-information action',()=>{
  const s=initialState();s.draft.attachments=[{name:'demo-application-sketch.svg',sample:true}];
  const projected=reviewItemsFor(s.draft,{includeCommercial:true});
  const rfq=saveRFQ(s,NOW).rfq;assert.ok(rfq.reviewItems.some(t=>t.id==='application:mounting-drawing'));assert.ok(rfq.openItems.some(t=>t.includes('illustrative')));
  const mounting=projected.find(t=>t.id==='application:mounting-drawing');assert.equal(mounting.owner,'Customer');assert.match(mounting.detail,/illustrative/);
  s.draft.attachments=[{name:'uploaded-reference.pdf',sample:false}];
  assert.ok(reviewItemsFor(s.draft,{includeCommercial:true}).some(t=>t.id==='application:mounting-drawing'));
  s.draft.mounting='Use existing mounting; dimensions attached';
  assert.ok(!reviewItemsFor(s.draft,{includeCommercial:true}).some(t=>t.id==='application:mounting-drawing'));
});

test('an unanswered question from a previous revision survives later quantity-only proposals without changing old records',()=>{
  let s=issue(saveRFQ(initialState(),NOW).state);
  s=saveRevision({...s,revisionDraft:{quantity:'250',timing:'',finish:'',message:'Please confirm the maximum outdoor operating temperature.'}},NOW).state;
  s=issue(s,s.activeRevisionId);const previous=structuredClone(s),question=activeQuote(s).reviewItems.find(i=>i.source.kind==='revision');
  s=saveRevision({...s,revisionDraft:{quantity:'300',timing:'',finish:'',message:''}},NOW).state;s=issue(s,s.activeRevisionId);
  const current=activeQuote(s).reviewItems.filter(i=>i.source.kind==='revision');assert.equal(current.length,1);assert.deepEqual(current[0],question);
  assert.deepEqual(s.quotes.slice(0,2),previous.quotes);assert.deepEqual(s.replies[0],previous.replies[0]);
  const q=activeQuote(s),request=requestNextStep(s,{quoteId:q.id,quoteVersion:q.version,message:'Review the retained questions.'},NOW);
  assert.deepEqual(request.nextStep.openQuestions.find(i=>i.id===question.id),question);
});
