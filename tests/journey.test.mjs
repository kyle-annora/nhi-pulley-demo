import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,product,saveRFQ,prepareQuote,saveRevision,activeRFQ,activeQuote,hasDraftChanges,restoreState} from '../src/domain.mjs';
import {assessCandidate,rankedCandidates,chooseCandidate,confirmExplorerRequirement,simulateReply,issueRevisedQuote,quoteOpenItems,quoteComparison} from '../src/journey.mjs';
const NOW='2026-11-01T12:00:00.000Z';
function caseWithRevision(){let s=initialState();s.draft.finish='zinc';s=prepareQuote(saveRFQ(s,NOW).state,NOW);s.revisionDraft={quantity:'250',timing:'5 weeks from order',finish:'',message:'Review zinc suitability and mounting.'};return saveRevision(s,NOW).state;}
test('guided comparison explains matches and differences without claiming fit or manufacturing tolerance',()=>{
  const context={purpose:'Replace an existing pulley',belt:'Back side of V-belt',od:'79.375',flat:'69.85',width:'19.05',unit:'mm'};
  const ranking=rankedCandidates(context);assert.equal(ranking[0].product.id,'F-4412');assert.equal(ranking[0].assessment.matches,3);assert.equal(ranking[0].assessment.fitConfirmed,false);
  assert.equal(ranking.find(r=>r.product.id==='F-4414').assessment.mismatches,2);
  assert.equal(assessCandidate(product('F-4412'),{...context,od:'79.4'}).mismatches,1);
  assert.equal(assessCandidate(product('F-4412'),{unit:'in'}).status,'Dimensions not supplied');
  let s=initialState();s.discovery=context;s=chooseCandidate(s,'F-4412',true);assert.equal(s.draft.selectionBasis.context.od,'79.375');assert.equal(s.draft.belt,context.belt);
  s.discovery.od='invalid';assert.throws(()=>chooseCandidate(s,'F-4412',true));
});
test('Explorer browsing is not confirmation; explicit inputs persist into immutable RFQ with mismatch flags',()=>{
  let s=initialState();s.interests=['belt','mount'];assert.equal(s.draft.explorerRequirements,undefined);
  assert.throws(()=>confirmExplorerRequirement(s,{feature:'belt',value:'0'}));
  s=confirmExplorerRequirement(s,{feature:'belt',value:'22.225',unit:'mm',note:'Measured between flanges'},NOW);
  s=confirmExplorerRequirement(s,{feature:'mount',unknown:true,note:'Check offset against drawing'},NOW);
  s=saveRFQ(s,NOW).state;const r=activeRFQ(s);assert.equal(r.requirements.explorerRequirements.length,2);assert.ok(r.openItems.some(i=>i.includes('differs')));
  s=confirmExplorerRequirement(s,{feature:'belt',value:'3/4',unit:'in'},NOW);assert.equal(s.draft.explorerRequirements[0].feature,'mount');assert.equal(s.draft.explorerRequirements[1].matchesCatalog,true);assert.equal(r.requirements.explorerRequirements[0].value,22.225);assert.equal(hasDraftChanges(s),true);
  const changed=chooseCandidate(s,'F-4414');assert.equal(changed.draft.explorerRequirements.length,0);assert.equal(activeRFQ(changed).requirements.explorerRequirements.length,2);
});
test('reply and v2 reference the exact original version, preserve snapshots, and distinguish request from proposal',()=>{
  let s=caseWithRevision();const original=JSON.stringify(activeQuote(s)),rfq=JSON.stringify(activeRFQ(s)),rev=s.revisions[0];
  s=simulateReply(s,rev.id,NOW);assert.equal(s.quotes.length,1);assert.equal(s.replies.length,1);assert.equal(s.replies[0].requirements.timing,'5 weeks from order');assert.match(s.replies[0].lead,/6–8/);assert.ok(s.replies[0].tasks.some(t=>t.unanswered));
  s=issueRevisedQuote(s,s.replies[0].id,NOW);const q=activeQuote(s);assert.equal(q.id,rev.quoteId);assert.equal(q.version,2);assert.equal(q.previousVersion,1);assert.equal(q.revisionId,rev.id);assert.equal(q.requirements.quantity,'250');assert.equal(q.lines[0].unitCents,830);assert.equal(q.totals.subtotalCents,226000);assert.equal(q.totals.totalCents,null);
  assert.ok(quoteOpenItems(q).some(t=>t.includes('Zinc is budgeted')));assert.equal(JSON.stringify(s.quotes[0]),original);assert.equal(JSON.stringify(activeRFQ(s)),rfq);assert.equal(quoteComparison(s.quotes[0],q).find(r=>r[0]==='Priced subtotal')[2],'$2,260.00');
  assert.equal(issueRevisedQuote(s,s.replies[0].id,NOW).quotes.length,2);assert.equal(simulateReply(s,rev.id,NOW).replies.length,1);
  assert.equal(activeQuote(prepareQuote(s,NOW)).version,2);assert.equal(activeQuote(restoreState(JSON.stringify(s))).version,2);
});
test('later revisions apply to v2 without mutating v1, and other finishes stay unpriced',()=>{
  let s=caseWithRevision();s=simulateReply(s,s.revisions[0].id,NOW);s=issueRevisedQuote(s,s.replies[0].id,NOW);const v2=JSON.stringify(activeQuote(s));
  s.revisionDraft={quantity:'300',timing:'',finish:'powder',message:'Review powder finish.'};s=saveRevision(s,NOW).state;assert.equal(s.revisions[1].quoteVersion,2);s=simulateReply(s,s.revisions[1].id,NOW);s=issueRevisedQuote(s,s.replies[1].id,NOW);assert.equal(activeQuote(s).version,3);assert.equal(activeQuote(s).requirements.quantity,'300');assert.equal(activeQuote(s).lines.find(l=>l.label.startsWith('Finish change')).unitCents,null);assert.equal(JSON.stringify(s.quotes[1]),v2);
});
test('existing first-version cases migrate without losing the active quote, and other products cannot inherit reply pricing',()=>{
  let old=caseWithRevision();delete old.replies;delete old.activeQuoteVersion;delete old.discovery;delete old.explorerDrafts;const restored=restoreState(JSON.stringify(old));assert.equal(activeQuote(restored).version,1);assert.deepEqual(restored.replies,[]);assert.ok(restored.discovery);
  let s=initialState();s.selected='F-4414';s=prepareQuote(saveRFQ(s,NOW).state,NOW);s.revisionDraft.message='Please review';s=saveRevision(s,NOW).state;assert.throws(()=>simulateReply(s,s.revisions[0].id,NOW),/F-4412/);
});
