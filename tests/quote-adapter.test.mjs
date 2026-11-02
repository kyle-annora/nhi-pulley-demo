import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {activeQuote,restoreState} from '../src/domain.mjs';
import {bindRevisionDraft,updateRevisionDraft,commitRevisionFor,selectQuoteVersion,quoteKey} from '../src/quote-adapter.mjs';
const fixture=()=>restoreState(readFileSync(new URL('./fixtures/round3-before-case.json',import.meta.url),'utf8'));
const records=s=>JSON.stringify([s.rfqs,s.quotes,s.revisions,s.replies]);
test('adopting the actual existing case and switching quote versions preserves every historical record',()=>{
  const s=fixture(),original=records(s);let n=bindRevisionDraft(s);
  assert.equal(activeQuote(n).version,2);assert.equal(records(n),original);
  n=selectQuoteVersion(n,n.activeQuoteId,1);assert.equal(activeQuote(n).requirements.quantity,'200');
  n=selectQuoteVersion(n,n.activeQuoteId,2);assert.equal(activeQuote(n).totals.subtotalCents,226000);
  assert.equal(records(restoreState(JSON.stringify(n))),original);
});
test('revision drafts resume only against their intended quote version, including after refresh',()=>{
  let s=bindRevisionDraft(fixture()),key=quoteKey(activeQuote(s));
  s=updateRevisionDraft(s,key,{quantity:'300',timing:'7 weeks',finish:'',message:'Review our revised volume.'});
  s=selectQuoteVersion(s,s.activeQuoteId,1);assert.equal(s.revisionDraft.quantity,'');
  s=updateRevisionDraft(s,quoteKey(activeQuote(s)),{quantity:'225',timing:'',finish:'',message:'A v1 question'});
  s=selectQuoteVersion(restoreState(JSON.stringify(s)),s.activeQuoteId,2);
  assert.equal(s.revisionDraft.quantity,'300');assert.equal(s.revisionDraft.message,'Review our revised volume.');
});
test('a v2 revision appends one exact-version request without modifying RFQs, quotes, replies or previous revisions',()=>{
  let s=bindRevisionDraft(fixture()),key=quoteKey(activeQuote(s));
  const previous={rfqs:JSON.stringify(s.rfqs),quotes:JSON.stringify(s.quotes),replies:JSON.stringify(s.replies),revisions:JSON.stringify(s.revisions)};
  const noChange=commitRevisionFor(s,key,{quantity:'',timing:'',finish:'',message:''});assert.ok(noChange.errors.message);
  const invalid=commitRevisionFor(s,key,{quantity:'0',timing:'',finish:'',message:'Review'});assert.ok(invalid.errors.quantity);
  const {state:n,revision:r}=commitRevisionFor(s,key,{quantity:'300',timing:'7 weeks from order',finish:'',message:'Please review a larger initial order.'},'2026-11-01T17:00:00Z');
  assert.equal(r.quoteVersion,2);assert.equal(r.quoteId,s.activeQuoteId);assert.equal(r.rfqId,activeQuote(s).rfqId);
  for(const k of ['rfqs','quotes','replies'])assert.equal(JSON.stringify(n[k]),previous[k]);
  assert.equal(JSON.stringify(n.revisions.slice(0,-1)),previous.revisions);assert.equal(n.revisions.length,s.revisions.length+1);
  assert.equal(n.revisionDraft.quantity,'');assert.equal(activeQuote(n).totals.subtotalCents,226000);
});
test('stale or missing quote-version callbacks cannot write a request to the wrong record',()=>{
  let s=bindRevisionDraft(fixture()),key=quoteKey(activeQuote(s));
  s=selectQuoteVersion(s,s.activeQuoteId,1);
  assert.throws(()=>commitRevisionFor(s,key,{message:'Wrong source'}),/displayed quote changed/);
  assert.throws(()=>selectQuoteVersion(s,s.activeQuoteId,99),/unavailable/);
});
