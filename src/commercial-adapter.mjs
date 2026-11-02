import {selectQuoteVersion} from './quote-adapter.mjs';
import {recordReviewItems,reviewHandoff} from './review-items.mjs';
import {activeQuote, clone, prepareQuote} from './domain.mjs';
import {simulateReply, issueRevisedQuote} from './journey.mjs';

// Additive, browser-local demo records. Existing RFQs, quotes, requests and replies
// remain immutable; the host owns persistence and the visible buyer/seller role.
const fail=(state,error)=>({state,error});
const unique=(records,predicate)=>{const found=records.filter(predicate);return found.length===1?found[0]:null;};
const commercial=s=>({drafts:{},releases:[],nextSteps:[],acknowledgements:[],...(s.commercial||{})});
const write=(s,patch)=>({...s,commercial:{...commercial(s),...patch}});
const text=(value,max=3000)=>typeof value==='string'&&value.trim().length<=max?value.trim():null;
const identity=q=>q?`${q.id}:v${q.version}`:null;
export const sellerDraftKey=({rfqId,revisionId})=>revisionId?`${rfqId}:revision:${revisionId}`:`${rfqId}:initial`;

function sourceContext(s,{rfqId=s.activeRfqId,revisionId=null}={}){
  const rfq=unique(s.rfqs||[],r=>r.id===rfqId);
  if(!rfq||!rfq.requirements||!rfq.product?.id||rfq.caseId!==s.caseId)return {error:'Open a saved inquiry from this demo case.'};
  const quotes=(s.quotes||[]).filter(q=>q.rfqId===rfq.id);
  if(new Set(quotes.map(q=>q.id)).size>1||quotes.some(q=>q.rfqVersion!==rfq.version||q.caseId!==rfq.caseId||q.product?.id!==rfq.product.id)||new Set(quotes.map(identity)).size!==quotes.length)return {error:'The saved quote and inquiry references do not match. Records are unchanged.'};
  for(const quote of quotes.filter(q=>q.version>1||q.responseId||q.revisionId||q.previousVersion)){
    const reply=unique(s.replies||[],r=>r.id===quote.responseId),revision=unique(s.revisions||[],r=>r.id===quote.revisionId);
    const base=unique(quotes,q=>q.id===quote.id&&q.version===quote.previousVersion);
    if(!reply||!revision||!base||reply.revisionId!==revision.id||reply.rfqId!==rfq.id||revision.rfqId!==rfq.id||reply.quoteId!==quote.id||revision.quoteId!==quote.id||reply.quoteVersion!==base.version||revision.quoteVersion!==base.version||quote.version<=base.version)return {error:'A revised quote is missing its exact original request and reply. Review the saved history.'};
  }
  const latestQuote=quotes.toSorted((a,b)=>b.version-a.version)[0]||null;
  let revision=null,sourceQuote=null,reply=null,issued=null;
  if(revisionId){
    revision=unique(s.revisions||[],r=>r.id===revisionId);
    if(!revision||revision.rfqId!==rfq.id)return {error:'This change request does not belong to the displayed inquiry.'};
    sourceQuote=unique(quotes,q=>q.id===revision.quoteId&&q.version===revision.quoteVersion);
    if(!sourceQuote)return {error:'The original quote version for this request is unavailable.'};
    const matches=(s.replies||[]).filter(r=>r.revisionId===revision.id);
    if(matches.length>1)return {error:'More than one reply points to this request. Review its history.'};
    reply=matches[0]||null;
    if(reply&&(reply.rfqId!==rfq.id||reply.quoteId!==sourceQuote.id||reply.quoteVersion!==sourceQuote.version||!unique(s.replies||[],r=>r.id===reply.id)))return {error:'This reply does not match the exact inquiry and quote version.'};
    const issuedMatches=reply?quotes.filter(q=>q.responseId===reply.id):[];
    if(issuedMatches.length>1)return {error:'More than one quote points to this reply. Review its history.'};
    issued=issuedMatches[0]||null;
    if(issued&&(issued.previousVersion!==sourceQuote.version||issued.revisionId!==revision.id||issued.version<=sourceQuote.version))return {error:'The revised quote has an invalid request or version reference.'};
  }
  const blockedReason=revision?(issued?'A quote has already been issued for this request.':identity(sourceQuote)!==identity(latestQuote)?'This request refers to an older quote. Open the latest quote before making another commercial change.':sourceQuote.product.id!=='F-4412'?'The seller reply example is available for F-4412 only.':null):latestQuote?'This inquiry already has an issued quote. Open that quote or a saved change request.':null;
  return {rfq,latestQuote,sourceQuote,revision,reply,issued,blockedReason,canDraft:!blockedReason,draftKey:sellerDraftKey({rfqId:rfq.id,revisionId})};
}

// A general seller entry works on the current quote, while an explicitly opened
// change request retains its exact source version. Neither action edits history.
export function sellerEntryState(s,revisionId=null){
  const revision=revisionId?unique(s.revisions||[],r=>r.id===revisionId):null;
  if(revisionId&&!revision)return fail(s,'Saved request unavailable.');
  const context=sourceContext(s,{rfqId:revision?.rfqId||s.activeRfqId,revisionId});
  if(context.error)return fail(s,context.error);
  const q=revision?context.sourceQuote:context.latestQuote;
  const selected=q?selectQuoteVersion(s,q.id,q.version):s;
  return {state:{...selected,activeRfqId:context.rfq.id,sellerRevisionId:revisionId,activeRevisionId:revision?.id||q?.revisionId||null,step:'seller'}};
}

export function commercialContext(s,options={}){
  const context=sourceContext(s,options);if(context.error)return context;
  const c=commercial(s),{rfq,latestQuote}=context;
  const pendingRevisions=(s.revisions||[]).filter(r=>r.rfqId===rfq.id&&r.quoteId===latestQuote?.id&&r.quoteVersion===latestQuote?.version&&!s.quotes.some(q=>q.revisionId===r.id));
  const nextSteps=c.nextSteps.filter(r=>r.rfqId===rfq.id);
  const nextStep=nextSteps.filter(r=>r.quoteId===latestQuote?.id&&r.quoteVersion===latestQuote?.version).at(-1)||null;
  const acknowledgement=nextStep?c.acknowledgements.find(a=>a.requestId===nextStep.id)||null:null;
  const reviewItems=recordReviewItems(latestQuote||rfq,{reply:(s.replies||[]).find(r=>r.id===latestQuote?.responseId),revision:(s.revisions||[]).find(r=>r.id===latestQuote?.revisionId),includeCommercial:Boolean(latestQuote)}),handoff=reviewHandoff(reviewItems);
  let nextActor,status;
  if(pendingRevisions.length){nextActor='Seller';status='New change request · awaiting seller reply';}
  else if(acknowledgement){nextActor=handoff.nextActor;status=handoff.status;}
  else if(nextStep){nextActor='Seller';status='Engineering review requested · awaiting seller acknowledgement';}
  else if(latestQuote){nextActor='Buyer';status=`Quote v${latestQuote.version} issued · review the example and choose a next step`;}
  else {nextActor='Seller';status='Saved inquiry · prepare and review the example quote';}
  return clone({...context,reviewItems,handoff,draft:c.drafts[context.draftKey]||null,pendingRevisions,nextSteps,nextStep,acknowledgement,nextActor,status,unresolvedNotice:'Technical questions, application fit, freight and tax remain open. This is not order acceptance.'});
}

function sourceFingerprint(s,context){
  return JSON.stringify({rfq:context.rfq,sourceQuote:context.sourceQuote,revision:context.revision,reply:context.reply,latestQuote:context.latestQuote,quoteIdentities:(s.quotes||[]).map(identity),replyIds:(s.replies||[]).map(r=>r.id)});
}

function projection(s,context,now){
  let n={...s,activeRfqId:context.rfq.id};
  if(!context.revision){n=prepareQuote(n,now);return {quote:activeQuote(n),reply:null};}
  n={...n,activeQuoteId:context.sourceQuote.id,activeQuoteVersion:context.sourceQuote.version,activeRevisionId:context.revision.id};
  n=simulateReply(n,context.revision.id,now);
  const reply=n.replies.find(r=>r.revisionId===context.revision.id);
  n=issueRevisedQuote(n,reply.id,now);
  return {quote:activeQuote(n),reply};
}

export function saveSellerDraft(s,{rfqId=s.activeRfqId,revisionId=null,sellerNote=''}={},now=new Date().toISOString()){
  const context=sourceContext(s,{rfqId,revisionId});
  if(context.error||context.blockedReason)return fail(s,context.error||context.blockedReason);
  const note=text(sellerNote);if(note===null)return fail(s,'Keep the seller note within 3,000 characters.');
  try{
    const preview=projection(s,context,now),draft={key:context.draftKey,rfqId:context.rfq.id,revisionId,sourceQuoteId:context.sourceQuote?.id||null,sourceQuoteVersion:context.sourceQuote?.version||null,createdAt:commercial(s).drafts[context.draftKey]?.createdAt||now,updatedAt:now,sellerNote:note,quote:preview.quote,reply:preview.reply,sourceFingerprint:sourceFingerprint(s,context),status:'Seller draft · not issued · example only'};
    const state=write(s,{drafts:{...commercial(s).drafts,[draft.key]:clone(draft)}});
    return {state,draft:clone(draft)};
  }catch{return fail(s,'The example quote draft could not be prepared. Saved records are unchanged.');}
}

export function reviewSellerDraft(s,key){
  const draft=commercial(s).drafts[key];if(!draft)return {error:'Save the seller draft before reviewing it.'};
  const context=sourceContext(s,draft);
  if(context.error||context.blockedReason)return {error:context.error||context.blockedReason};
  if(draft.sourceFingerprint!==sourceFingerprint(s,context))return {error:'The source records changed. Save and review a fresh draft before issuing it.'};
  return {key,fingerprint:JSON.stringify(draft),draft:clone(draft),rfq:clone(context.rfq),sourceQuote:clone(context.sourceQuote),revision:clone(context.revision),label:'Review exact example quotation before issue'};
}

export function issueSellerDraft(s,review,now=new Date().toISOString()){
  if(!review?.key||!review.fingerprint)return fail(s,'Review the saved seller draft before issuing it.');
  const c=commercial(s),released=c.releases.find(r=>r.key===review.key&&r.reviewFingerprint===review.fingerprint);
  if(released){
    const quote=unique(s.quotes||[],q=>q.id===released.quoteId&&q.version===released.quoteVersion);
    if(!quote)return fail(s,'The issued quotation is unavailable. Review the saved records.');
    return {state:s,quote:clone(quote),reply:clone((s.replies||[]).find(r=>r.id===quote.responseId)||null),duplicate:true};
  }
  const current=reviewSellerDraft(s,review.key);
  if(current.error)return fail(s,current.error);
  if(current.fingerprint!==review.fingerprint)return fail(s,'The seller draft changed after review. Review the current draft before issuing it.');
  const draft=c.drafts[review.key],context=sourceContext(s,draft);
  try{
    let state={...s,activeRfqId:context.rfq.id},reply=null;
    if(context.revision){
      state={...state,activeQuoteId:context.sourceQuote.id,activeQuoteVersion:context.sourceQuote.version,activeRevisionId:context.revision.id};
      state=simulateReply(state,context.revision.id,now);
      reply=state.replies.find(r=>r.revisionId===context.revision.id);
      state=issueRevisedQuote(state,reply.id,now);
    }else state=prepareQuote(state,now);
    const quote=activeQuote(state);
    // The immutable quotation records the reviewed note, without claiming that
    // the note answers any free-text engineering question.
    if(draft.sellerNote){quote.sellerNote=draft.sellerNote;quote.sellerNoteSource='Fictional seller note reviewed in the local demo';}
    state=write(state,{releases:[...c.releases,{key:draft.key,reviewFingerprint:review.fingerprint,rfqId:quote.rfqId,quoteId:quote.id,quoteVersion:quote.version,replyId:reply?.id||null,issuedAt:now,status:'Example issued locally · not sent by NHI'}]});
    return {state,quote:clone(quote),reply:clone(reply)};
  }catch{return fail(s,'The reviewed example could not be issued. Your saved records are unchanged.');}
}

// A per-item explanation is deliberately independent of issuing a quotation.
export function recordSellerReply(s,revisionId,now=new Date().toISOString()){
  const rev=unique(s.revisions||[],r=>r.id===revisionId);
  if(!rev)return fail(s,'Open a saved change request first.');
  const context=sourceContext(s,{rfqId:rev.rfqId,revisionId});
  if(context.error)return fail(s,context.error);
  if(context.reply)return {state:s,reply:clone(context.reply),duplicate:true};
  if(context.blockedReason)return fail(s,context.blockedReason);
  try{
    const state=simulateReply({...s,activeRfqId:context.rfq.id,activeQuoteId:context.sourceQuote.id,activeQuoteVersion:context.sourceQuote.version},revisionId,now);
    return {state,reply:clone(state.replies.find(r=>r.revisionId===revisionId))};
  }catch{return fail(s,'The simulated reply could not be recorded. Saved quotations are unchanged.');}
}

function latestQuoteContext(s,{quoteId,quoteVersion}){
  const quote=unique(s.quotes||[],q=>q.id===quoteId&&q.version===quoteVersion);
  if(!quote)return {error:'Open an exact saved quote version first.'};
  const context=sourceContext(s,{rfqId:quote.rfqId});
  if(context.error)return context;
  if(identity(quote)!==identity(context.latestQuote))return {error:'This is an earlier quote version. Open the latest quote before confirming a next step.'};
  const pending=(s.revisions||[]).filter(r=>r.rfqId===quote.rfqId&&r.quoteId===quote.id&&r.quoteVersion===quote.version&&!s.quotes.some(q=>q.revisionId===r.id));
  if(pending.length)return {error:'A new change request is awaiting the seller reply. Review the resulting quote before confirming the next step.'};
  return {quote,...context};
}

export function requestNextStep(s,{quoteId,quoteVersion,kind='engineering-review',message=''}={},now=new Date().toISOString()){
  const context=latestQuoteContext(s,{quoteId,quoteVersion});if(context.error)return fail(s,context.error);
  if(kind!=='engineering-review')return fail(s,'This demo supports an engineering-review request.');
  const note=text(message);if(note===null||!note)return fail(s,'Describe what engineering should review (up to 3,000 characters).');
  const c=commercial(s),existing=c.nextSteps.find(r=>r.quoteId===quoteId&&r.quoteVersion===quoteVersion&&r.kind===kind);
  if(existing)return {state:s,nextStep:clone(existing),duplicate:true};
  const quote=context.quote,reply=(s.replies||[]).find(r=>r.id===quote.responseId);
  const nextStep={id:`NEXT-DEMO-${String(c.nextSteps.length+1).padStart(3,'0')}`,caseId:context.rfq.caseId,rfqId:context.rfq.id,quoteId,quoteVersion,kind,message:note,createdAt:now,quoteSnapshot:clone(quote),openQuestions:recordReviewItems(quote,{reply,revision:(s.revisions||[]).find(r=>r.id===quote.revisionId)}),reviewItems:recordReviewItems(quote,{reply,revision:(s.revisions||[]).find(r=>r.id===quote.revisionId)}),status:'Engineering review requested · local example only',boundary:'This requests a discussion. It does not accept the quote, create an order or approve application fit.'};
  return {state:write(s,{nextSteps:[...c.nextSteps,nextStep]}),nextStep:clone(nextStep)};
}

export function acknowledgeNextStep(s,{requestId,message=''}={},now=new Date().toISOString()){
  const c=commercial(s),request=unique(c.nextSteps,r=>r.id===requestId);
  if(!request)return fail(s,'Open the saved engineering-review request first.');
  const context=latestQuoteContext(s,request);if(context.error)return fail(s,context.error);
  if(request.rfqId!==context.rfq.id||request.caseId!==context.rfq.caseId||JSON.stringify(request.quoteSnapshot)!==JSON.stringify(context.quote))return fail(s,'The request does not match its saved quote. Records are unchanged.');
  const existing=c.acknowledgements.find(a=>a.requestId===requestId);
  if(existing)return {state:s,acknowledgement:clone(existing),nextStep:clone(request),duplicate:true};
  const note=text(message);if(note===null||!note)return fail(s,'Confirm the proposed engineering-review action (up to 3,000 characters).');
  const acknowledgement={id:`ACK-DEMO-${String(c.acknowledgements.length+1).padStart(3,'0')}`,requestId,caseId:request.caseId,rfqId:request.rfqId,quoteId:request.quoteId,quoteVersion:request.quoteVersion,createdAt:now,message:note,status:'Engineering review agreed · local example only',boundary:'The next action is agreed. Technical questions, application fit, price exclusions and delivery approval remain open. This is not order acceptance.'};
  return {state:write(s,{acknowledgements:[...c.acknowledgements,acknowledgement]}),acknowledgement:clone(acknowledgement),nextStep:clone(request)};
}
