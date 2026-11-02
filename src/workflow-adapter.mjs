import {recordReviewItems,reviewHandoff} from './review-items.mjs';
import {activeQuote,activeRFQ,hasDraftChanges} from './domain.mjs';
import {issueRevisedQuote} from './journey.mjs';

const fail=error=>({error});
const unique=(items,predicate)=>{const matches=items.filter(predicate);return matches.length===1?matches[0]:null;};

// A reply is a record chain, never an inferred response to the latest working draft.
export function replyContext(state){
  const revisions=state.revisions||[],replies=state.replies||[],quotes=state.quotes||[],rfqs=state.rfqs||[];
  let revision;
  if(state.activeRevisionId){
    revision=unique(revisions,r=>r.id===state.activeRevisionId);
    if(!revision)return fail('That saved change request is unavailable. Open its quote and choose a saved request.');
  }else{
    const quote=activeQuote(state);
    if(!quote)return fail('Open a saved change request to view its simulated reply.');
    revision=revisions.filter(r=>r.quoteId===quote.id&&r.quoteVersion===quote.version&&r.rfqId===quote.rfqId).at(-1);
    if(!revision)return fail('No saved change request is selected for this quote version.');
  }
  if((state.activeRfqId&&state.activeRfqId!==revision.rfqId)||(state.activeQuoteId&&state.activeQuoteId!==revision.quoteId))return fail('This request belongs to a different inquiry or quote. Reopen it from the matching saved quote.');
  const base=unique(quotes,q=>q.id===revision.quoteId&&q.version===revision.quoteVersion);
  const rfq=unique(rfqs,r=>r.id===revision.rfqId);
  if(!base||!rfq||base.rfqId!==rfq.id||base.rfqVersion!==rfq.version||base.caseId!==rfq.caseId||base.product?.id!==rfq.product?.id)return fail('The original quote and inquiry references do not match. The saved records have not been changed.');
  const reply=unique(replies,r=>r.revisionId===revision.id);
  if(!reply)return fail('No simulated reply is available for this request. Open the saved change request to continue.');
  if(replies.filter(r=>r.id===reply.id).length!==1)return fail('This reply identifier is not unique. Reopen the saved request to review its history.');
  if(reply.quoteId!==base.id||reply.quoteVersion!==base.version||reply.rfqId!==rfq.id)return fail('The simulated reply does not match this exact quote version and inquiry. The saved records have not been changed.');
  if(base.product.id!=='F-4412')return fail('The simulated reply scenario is available for F-4412 only.');
  const issuedMatches=quotes.filter(q=>q.responseId===reply.id);
  if(issuedMatches.length>1)return fail('More than one quote points to this reply. Reopen the saved quote to review its history.');
  const issued=issuedMatches[0]||null;
  if(issued&&(issued.id!==base.id||issued.previousVersion!==base.version||issued.version<=base.version||issued.revisionId!==revision.id||issued.rfqId!==rfq.id||issued.rfqVersion!==rfq.version||issued.caseId!==rfq.caseId||issued.product?.id!==base.product.id))return fail('The revised quote does not match this reply and original quote. The saved records have not been changed.');
  const selectedQuote=state.activeQuoteId?activeQuote(state):null;
  if(state.activeQuoteId&&(!selectedQuote||![base.version,issued?.version].includes(selectedQuote.version)))return fail('The displayed quote version does not belong to this reply. Reopen the reply from its original or revised quote.');
  try{
    // Reuse the domain's commercial example; this projection never becomes host state.
    const quote=issued||activeQuote(issueRevisedQuote(state,reply.id,reply.createdAt));
    if(!quote?.totals||!Number.isFinite(quote.totals.subtotalCents))return fail('The example quotation details are incomplete. The saved records have not been changed.');
    return structuredClone({reply,revision,base,rfq,issued,nextVersion:quote.version,subtotalCents:quote.totals.subtotalCents,pendingItems:quote.totals.pending||[]});
  }catch{return fail('The example quotation details are incomplete. The saved records have not been changed.');}
}

export function openReplyQuote(state,replyId,now){
  const context=replyContext(state);
  if(context.error)return {state,error:context.error};
  if(context.reply.id!==replyId)return {state,error:'The displayed reply changed. Reopen the current reply before continuing.'};
  try{
    const next=issueRevisedQuote(state,replyId,now),quote=activeQuote(next);
    return {state:next,quote};
  }catch{return {state,error:'The example quote could not be opened. Your saved records are unchanged.'};}
}

export function openReplyRevision(state,revisionId){
  const context=replyContext(state);
  if(context.error)return {state,error:context.error};
  if(context.revision.id!==revisionId)return {state,error:'The displayed reply changed. Reopen the current reply before continuing.'};
  return {state:{...state,activeRfqId:context.rfq.id,activeQuoteId:context.base.id,activeQuoteVersion:context.base.version,activeRevisionId:context.revision.id,step:'revision'}};
}

// Navigation reports actual case facts. Reaching a later page never marks earlier work approved.
export function navigationState(state){
  const rfq=activeRFQ(state),candidate=state.selected||'No candidate selected';
  const selectedQuote=activeQuote(state),quote=selectedQuote?.rfqId===rfq?.id?selectedQuote:null;
  const inputs=(state.draft.explorerRequirements||[]).filter(r=>r.productId===state.selected).length;
  const requests=quote?(state.revisions||[]).filter(r=>r.quoteId===quote.id&&r.quoteVersion===quote.version&&r.rfqId===quote.rfqId):[];
  const pending=requests.filter(r=>!(state.replies||[]).some(reply=>reply.revisionId===r.id&&reply.quoteId===r.quoteId&&reply.quoteVersion===r.quoteVersion&&reply.rfqId===r.rfqId)).length;
  const unissued=requests.filter(r=>!(state.quotes||[]).some(q=>q.revisionId===r.id&&q.rfqId===r.rfqId));
  const current={review:'configure',rfq:'configure',response:'revision',seller:quote?'quote':'configure',next:'revision'}[state.step]||state.step;
  const response=state.step==='response'?replyContext(state):null;
  const nextStep=quote?(state.commercial?.nextSteps||[]).find(r=>r.quoteId===quote.id&&r.quoteVersion===quote.version):null;
  const acknowledged=nextStep&&(state.commercial?.acknowledgements||[]).some(a=>a.requestId===nextStep.id);
  const hasNewChange=!!nextStep&&unissued.length>0;
  const revisionDetail=response?(response.error?'Reply unavailable · review context':`${response.reply.id} · simulated`):hasNewChange?`v${quote.version} · ${unissued.length} new ${unissued.length===1?'change':'changes'} awaiting seller reply`:nextStep?(acknowledged?reviewHandoff(recordReviewItems(nextStep)).status:'Review request awaiting seller acknowledgement'):!quote?'Open an example quote first':!requests.length?`No request for v${quote.version}`:pending?`For v${quote.version} · ${requests.length} ${requests.length===1?'request':'requests'} · ${pending} without a reply`:`For v${quote.version} · ${requests.length} ${requests.length===1?'request':'requests'} · simulated reply available`;

  return [
    {key:'select',label:'Select pulley',route:'select',available:true,detail:candidate},
    {key:'explore',label:'Explore in 3D',route:'explore',available:true,detail:inputs?`${inputs} customer ${inputs===1?'input':'inputs'} saved`:'Optional · inspect dimensions'},
    {key:'configure',label:'Configure & inquire',route:'configure',available:true,detail:rfq?(hasDraftChanges(state)?'Draft changed · saved RFQ retained':`${rfq.id} saved`):'Working draft · not saved'},
    {key:'quote',label:'Review quote',route:'quote',available:!!rfq,detail:quote?`${quote.id} · v${quote.version}`:rfq?'Example quote not opened':'Save an inquiry first'},
    {key:'revision',label:'Follow-up & next step',route:nextStep&&!hasNewChange?'next':'revision',available:!!quote,detail:revisionDetail}
  ].map(step=>({...step,current:step.key===current}));
}
