import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initialState,restoreState} from '../src/domain.mjs';
import {navigationContext,canonicalWorkspaceRoute,applyWorkspaceRoute} from '../src/navigation-context.mjs';
import {commercialContext} from '../src/commercial-adapter.mjs';

const fixture=()=>restoreState(readFileSync(new URL('./fixtures/round20-before-sample-case.json',import.meta.url),'utf8'));
const records=s=>JSON.stringify({rfqs:s.rfqs,quotes:s.quotes,revisions:s.revisions,replies:s.replies,commercial:s.commercial,draft:s.draft,explorerDrafts:s.explorerDrafts});
const open=(s,route)=>{const result=applyWorkspaceRoute(s,route);assert.ifError(result.error);return result;};

test('canonical history restores Q003 after opening another RFQ instead of following mutable active state',()=>{
  const original=fixture(),snapshot=records(original),atQuote=open(original,'#quote');
  assert.equal(atQuote.route,'#quote?rfq=RFQ-DEMO-003');
  const atHistory=open(atQuote.state,'#history');
  const second=original.rfqs.find(r=>r.id==='RFQ-DEMO-002');
  const other=open(atHistory.state,`#rfq?rfq=${second.id}&version=${second.version}`);
  assert.equal(other.state.activeRfqId,second.id);
  const historyBack=open(other.state,atHistory.route),quoteBack=open(historyBack.state,atQuote.route);
  assert.equal(quoteBack.state.activeRfqId,'RFQ-DEMO-003');
  assert.equal(commercialContext(quoteBack.state).latestQuote.id,'Q-DEMO-003');
  assert.equal(records(quoteBack.state),snapshot);
  assert.equal(commercialContext(quoteBack.state).pendingRevisions[0].changes.find(c=>c.field==='quantity').after,'300');
});

test('historical document navigation uses its own RFQ while reading never rebinds the active quote or typed draft',()=>{
  const state=fixture();state.revisionDraft.message='Keep this unsent request';
  const before=JSON.stringify(state),result=open(state,'#quote-document?source=quote&id=Q-DEMO-002&version=1');
  assert.equal(JSON.stringify(state),before);
  assert.equal(result.state.activeQuoteId,'Q-DEMO-003');assert.equal(result.state.activeQuoteVersion,2);
  assert.equal(result.state.revisionDraft.message,'Keep this unsent request');
  assert.equal(result.context.quote.version,1);assert.equal(result.context.latestQuote.version,2);
  assert.equal(result.context.hrefs.work,'#quote?rfq=RFQ-DEMO-002');
  assert.equal(result.context.hrefs.inquiry,'#rfq?rfq=RFQ-DEMO-002&version=2');
  const detail=open(result.state,result.context.hrefs.technical);
  assert.equal(detail.context.rfq.id,'RFQ-DEMO-002');
  assert.equal(detail.route,'#quote-document?source=quote&id=Q-DEMO-002&version=1&view=reference');
  assert.equal(detail.context.hrefs.files,'#quote-document?source=quote&id=Q-DEMO-002&version=1&view=attachments');
  assert.equal(detail.state.activeQuoteId,'Q-DEMO-003');
  const current=open(detail.state,result.context.hrefs.work);
  assert.equal(current.state.activeQuoteId,'Q-DEMO-002');assert.equal(current.state.activeQuoteVersion,2);
  assert.equal(current.state.revisionDraftsByQuote['Q-DEMO-003:v2'].message,'Keep this unsent request');
});

test('invalid explicit identities reject without falling back to active or changing records',()=>{
  for(const route of ['#quote?rfq=missing','#rfq?rfq=RFQ-DEMO-002&version=99','#revision?rfq=RFQ-DEMO-003&quote=Q-DEMO-002&version=1','#response?rfq=RFQ-DEMO-003&reply=REPLY-DEMO-002','#next?rfq=RFQ-DEMO-003&quote=Q-DEMO-003&version=2&plan=missing','#seller?rfq=RFQ-DEMO-003&request=missing']){
    const state=fixture(),before=JSON.stringify(state),result=applyWorkspaceRoute(state,route);
    assert.ok(result.error,route);assert.equal(result.state,state);assert.equal(JSON.stringify(state),before);
  }
});

test('request, reply and saved plan routes retain exact quote versions across reload context',()=>{
  const state=fixture(),revision=state.revisions.find(r=>r.id==='REV-DEMO-002'),reply=state.replies.find(r=>r.revisionId===revision.id),plan=state.commercial.nextSteps.find(r=>r.rfqId===revision.rfqId);
  const request=open(state,`#revision?rfq=${revision.rfqId}&quote=${revision.quoteId}&version=${revision.quoteVersion}&request=${revision.id}`);
  assert.equal(request.state.activeRevisionId,revision.id);
  const response=open(state,`#response?rfq=${reply.rfqId}&reply=${reply.id}`);
  assert.equal(response.state.activeRevisionId,revision.id);assert.equal(response.state.activeQuoteVersion,reply.quoteVersion);
  const reload=open(state,response.route);assert.equal(reload.context.reply.id,reply.id);
  const next=open(state,`#next?rfq=${plan.rfqId}&quote=${plan.quoteId}&version=${plan.quoteVersion}&plan=${plan.id}`);
  assert.equal(next.context.nextStep.id,plan.id);assert.equal(next.state.activeRfqId,plan.rfqId);
  assert.equal(records(next.state),records(state));
});

test('legacy route canonicalization keeps the current source while a fresh walkthrough has no invented records',()=>{
  const state=fixture();
  assert.equal(canonicalWorkspaceRoute(state,'rfq').route,'#rfq?rfq=RFQ-DEMO-003&version=3');
  assert.equal(canonicalWorkspaceRoute(state,'history').route,'#history?rfq=RFQ-DEMO-003');
  const fresh=initialState(),result=open(fresh,'#explore');
  assert.equal(result.context.isDraft,true);assert.equal(result.context.rfq,null);
  assert.equal(result.context.hrefs.inquiry,'#configure');assert.equal(result.context.hrefs.quote,null);
  assert.equal(records(result.state),records(fresh));
});

test('a new request on v2 does not reopen the v1 request that produced it',()=>{
  const state=fixture(),quote=state.quotes.find(q=>q.id===state.activeQuoteId&&q.version===state.activeQuoteVersion);
  state.activeRevisionId=quote.revisionId;state.revisionEditingKey=`${quote.id}:v${quote.version}`;
  const result=open(state,'#revision');
  assert.equal(result.context.quote.version,2);assert.equal(result.context.revision,null);
  assert.equal(result.state.activeQuoteVersion,2);assert.equal(result.state.revisionEditingKey,state.revisionEditingKey);
  assert.equal(result.route,'#revision?rfq=RFQ-DEMO-003&quote=Q-DEMO-003&version=2');
});

test('source references and duplicate saved identities do not produce a misleading case navigation',()=>{
  const state=fixture(),q=state.quotes.find(q=>q.id==='Q-DEMO-002'&&q.version===1);
  const context=navigationContext(state,`#record?source=quote&id=${q.id}&version=${q.version}&section=questions&from=quote-document&owner=Engineering`);
  assert.equal(context.rfq.id,'RFQ-DEMO-002');assert.equal(context.hrefs.files,'#quote-document?source=quote&id=Q-DEMO-002&version=1&view=attachments');
  state.rfqs.push(structuredClone(state.rfqs[2]));
  assert.ok(navigationContext(state,'#quote?rfq=RFQ-DEMO-003').error);
});


test('retired quote reference bookmarks open the exact document without changing active case or draft',()=>{
  for(const section of ['questions','specification','files']){
    const state=fixture();state.revisionDraft.message='Keep the unsent v2 request';
    const before=records(state),result=open(state,`#record?source=quote&id=Q-DEMO-002&version=1&section=${section}&owner=Customer&item=application%3Amounting-drawing`);
    assert.equal(result.step,'quote-document');
    assert.equal(result.route,`#quote-document?source=quote&id=Q-DEMO-002&version=1&view=${section==='files'?'attachments':'reference'}&detail=application%3Amounting-drawing`);
    assert.equal(result.context.rfq.id,'RFQ-DEMO-002');assert.equal(result.context.quote.version,1);
    assert.equal(result.state.activeQuoteId,'Q-DEMO-003');assert.equal(result.state.activeQuoteVersion,2);
    assert.equal(result.state.revisionDraft.message,'Keep the unsent v2 request');assert.equal(records(result.state),before);
    assert.equal(open(result.state,result.route).route,result.route);
  }
});

test('retired RFQ and draft references reveal information inside their original document',()=>{
  const state=fixture(),before=records(state);
  const rfq=open(state,'#record?source=rfq&id=RFQ-DEMO-002&version=2&section=files');
  assert.equal(rfq.route,'#rfq?rfq=RFQ-DEMO-002&version=2&view=reference');assert.equal(rfq.state.activeRfqId,'RFQ-DEMO-002');
  assert.equal(records(rfq.state),before);
  assert.equal(open(state,'#record?source=draft&product=F-4412&section=questions&from=review').route,'#review?view=reference');
  assert.equal(open(state,'#record?source=draft&product=F-4412&section=specification&from=configure').route,'#review?view=reference');
});

test('retired reference links are validated before redirect and never substitute another record',()=>{
  for(const route of ['#record?source=quote&id=missing&version=1&section=questions','#record?source=quote&id=Q-DEMO-002&version=99&section=files','#record?source=rfq&id=RFQ-DEMO-002&version=1&section=files','#record?source=draft&product=F-4414&section=questions']){
    const state=fixture(),before=JSON.stringify(state),result=applyWorkspaceRoute(state,route);
    assert.ok(result.error,route);assert.equal(result.state,state);assert.equal(JSON.stringify(state),before);
  }
});
