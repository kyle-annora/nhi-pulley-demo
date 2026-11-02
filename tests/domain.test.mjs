import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,findProducts,parseDimension,validateDraft,openItems,saveRFQ,prepareQuote,saveRevision,activeRFQ,activeQuote,hasDraftChanges,quoteTotals,restoreState} from '../src/domain.mjs';
const NOW='2026-10-31T12:00:00.000Z';
test('catalog searches distinguish OD, flat diameter and width, including fractions and metric',()=>{
  assert.equal(parseDimension('3-1/8'),3.125);assert.equal(parseDimension('2 3/4'),2.75);
  assert.deepEqual(findProducts({part:'f4412'}).map(p=>p.id),['F-4412']);
  assert.deepEqual(findProducts({od:'3-1/8',width:'3/4'}).map(p=>p.id),['F-4412']);
  assert.deepEqual(findProducts({flat:'2.75'}).map(p=>p.id),['F-4412','F-4414']);
  assert.deepEqual(findProducts({od:'79.375',width:'19.05',unit:'mm'}).map(p=>p.id),['F-4412']);
  assert.equal(findProducts({od:'2.75'}).length,0);assert.equal(findProducts({od:'bad'}).length,0);assert.equal(findProducts({od:'1/0'}).length,0);
});
test('missing technical inputs stay unknown, while required identity and quantity are validated',()=>{
  const s=initialState();assert.deepEqual(validateDraft(s.draft),{});assert.equal(openItems(s.draft).length,4);assert.ok(openItems(s.draft).some(item=>item.includes('No mounting drawing')));
  for(const quantity of ['0','-1','1.5','1e4','abc'])assert.ok(validateDraft({...s.draft,quantity}).quantity);
  assert.ok(validateDraft({...s.draft,email:'not-email'}).email);
  assert.ok(validateDraft({...s.draft,finish:'custom',notes:''}).notes);
  assert.ok(validateDraft({...s.draft,load:'-5'}).load);
});
test('RFQ captures immutable product, attachments and context, deduplicates repeated saves',()=>{
  const s=initialState();s.interests=['belt'];s.draft.attachments=[{name:'demo.svg',size:4,data:'test',sample:true}];
  const result=saveRFQ(s,NOW);let next=result.state;
  assert.equal(s.rfqs.length,0);assert.equal(activeRFQ(next).product.id,'F-4412');
  next.draft.quantity='500';next.draft.attachments[0].name='changed';next.interests.push('mount');
  assert.equal(activeRFQ(next).requirements.quantity,'200');assert.equal(activeRFQ(next).requirements.attachments[0].name,'demo.svg');assert.deepEqual(activeRFQ(next).interests,['belt']);assert.equal(hasDraftChanges(next),true);
  const other=saveRFQ(next,NOW).state;assert.equal(other.rfqs.length,2);assert.equal(activeRFQ(other).version,2);
  assert.equal(saveRFQ(other,NOW).state.rfqs.length,2);
});
test('quote arithmetic uses cents and unpriced items never become a zero final total',()=>{
  let s=initialState();s.draft.finish='zinc';s=saveRFQ(s,NOW).state;s=prepareQuote(s,NOW);const q=activeQuote(s);
  assert.equal(q.totals.subtotalCents,175500);assert.equal(q.totals.totalCents,null);assert.equal(q.lines.filter(l=>l.unitCents===null).length,3);
  assert.equal(q.requirements.finish,'zinc');assert.equal(q.rfqId,activeRFQ(s).id);
  s.draft.quantity='500';assert.equal(q.requirements.quantity,'200');assert.equal(prepareQuote(s,NOW).quotes.length,1);
  assert.deepEqual(quoteTotals([{label:'A',qty:3,unitCents:110}]),{subtotalCents:330,totalCents:330,pending:[]});
});
test('new saved RFQ receives its own quote and comparison product cannot inherit F-4412 price',()=>{
  let s=prepareQuote(saveRFQ(initialState(),NOW).state,NOW);const original=JSON.stringify(s.quotes[0]);
  s.selected='F-4414';s.draft.quantity='300';s=saveRFQ(s,NOW).state;assert.equal(s.activeQuoteId,null);
  s=prepareQuote(s,NOW);assert.equal(s.quotes.length,2);assert.equal(activeQuote(s).product.id,'F-4414');assert.equal(activeQuote(s).lines[0].unitCents,null);assert.equal(JSON.stringify(s.quotes[0]),original);
});
test('revision validates meaningful change and retains the exact original quote',()=>{
  let s=prepareQuote(saveRFQ(initialState(),NOW).state,NOW);const original=JSON.stringify(activeQuote(s));
  assert.ok(saveRevision(s,NOW).errors.message);
  s.revisionDraft={quantity:'200',timing:'',finish:'',message:''};assert.ok(saveRevision(s,NOW).errors.message);
  s.revisionDraft={quantity:'250',timing:'5 weeks from order',finish:'',message:'Please review delivery.'};
  const result=saveRevision(s,NOW);assert.equal(result.state.revisions.length,1);assert.equal(result.revision.changes.length,2);assert.equal(result.revision.quoteId,activeQuote(s).id);assert.equal(JSON.stringify(activeQuote(result.state)),original);assert.equal(result.state.revisionDraft.message,'');
});
test('state round trips with all snapshots and invalid state falls back safely',()=>{
  let s=prepareQuote(saveRFQ(initialState(),NOW).state,NOW);s.revisionDraft.message='Can you review the mounting drawing?';s=saveRevision(s,NOW).state;
  assert.deepEqual(restoreState(JSON.stringify(s)),s);assert.equal(restoreState('invalid'),null);assert.equal(restoreState('{"schema":2}'),null);
});
