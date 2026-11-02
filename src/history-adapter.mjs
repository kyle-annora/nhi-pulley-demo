import {activeQuote} from './domain.mjs';
import {bindRevisionDraft} from './quote-adapter.mjs';
import {replyContext} from './workflow-adapter.mjs';

const unique=(items,predicate)=>{const found=items.filter(predicate);return found.length===1?found[0]:null;};
const unavailable=error=>({error});
const arrays=state=>({rfqs:state.rfqs||[],quotes:state.quotes||[],revisions:state.revisions||[],replies:state.replies||[]});

// Resolve a saved identity before changing the active case. Never substitute the latest record.
function resolveRecord(state,target){
  const {rfqs,quotes,revisions,replies}=arrays(state);
  if(!target||!target.id||!['rfq','quote','revision','reply'].includes(target.type))return unavailable('Choose a saved inquiry, quote, request or reply.');
  let rfq,quote,revision,reply;
  if(target.type==='rfq'){
    rfq=unique(rfqs,r=>r.id===target.id);
    if(!rfq)return unavailable('This inquiry is missing or its identifier is not unique.');
  }else if(target.type==='quote'){
    quote=unique(quotes,q=>q.id===target.id&&q.version===target.version);
    if(!quote)return unavailable('This exact quote version is missing or is not unique.');
  }else{
    if(target.type==='reply'){
      reply=unique(replies,r=>r.id===target.id);
      if(!reply)return unavailable('This simulated reply is missing or its identifier is not unique.');
      revision=unique(revisions,r=>r.id===reply.revisionId);
    }else revision=unique(revisions,r=>r.id===target.id);
    if(!revision)return unavailable('The saved change request is missing or its identifier is not unique.');
    quote=unique(quotes,q=>q.id===revision.quoteId&&q.version===revision.quoteVersion);
    if(!quote)return unavailable('The original quote version for this request is unavailable.');
    if(revision.rfqId!==quote.rfqId)return unavailable('This request does not match its saved inquiry and quote.');
  }
  if(quote)rfq=unique(rfqs,r=>r.id===quote.rfqId);
  if(!rfq||!rfq.product?.id||!rfq.requirements||rfq.caseId!==state.caseId)return unavailable('The saved inquiry is incomplete or belongs to a different case.');
  if(quote&&(quote.rfqVersion!==rfq.version||quote.caseId!==rfq.caseId||quote.product?.id!==rfq.product.id||!quote.requirements))return unavailable('The quote and saved inquiry references do not match.');
  // A revised quote must retain a coherent reply → original request → original quote chain.
  if(quote&&(quote.version>1||quote.responseId||quote.revisionId||quote.previousVersion)){
    const sourceReply=unique(replies,r=>r.id===quote.responseId);
    if(!sourceReply||sourceReply.revisionId!==quote.revisionId)return unavailable('The revised quote is missing its original request or simulated reply.');
    const context=replyContext({...state,activeRfqId:rfq.id,activeQuoteId:quote.id,activeQuoteVersion:quote.version,activeRevisionId:sourceReply.revisionId});
    if(context.error)return unavailable(context.error);
    if(context.issued?.id!==quote.id||context.issued?.version!==quote.version)return unavailable('The revised quote does not match its saved reply.');
  }
  if(reply){
    const context=replyContext({...state,activeRfqId:rfq.id,activeQuoteId:quote.id,activeQuoteVersion:quote.version,activeRevisionId:revision.id});
    if(context.error)return unavailable(context.error);
    if(context.reply.id!==reply.id)return unavailable('This reply does not match the selected change request.');
  }
  return {rfq,quote,revision,reply};
}

export function openHistoryRecord(state,target){
  const context=resolveRecord(state,target);
  if(context.error)return {state,error:context.error};
  // Keep an in-progress per-version request before switching its displayed quote.
  let source=activeQuote(state)?bindRevisionDraft(state):state;
  if(activeQuote(source)&&source.revisionDraftQuoteKey)source={...source,revisionDraftsByQuote:{...source.revisionDraftsByQuote,[source.revisionDraftQuoteKey]:structuredClone(source.revisionDraft)}};
  let next={...source,activeRfqId:context.rfq.id,activeQuoteId:context.quote?.id||null,activeQuoteVersion:context.quote?.version||1,activeRevisionId:context.revision?.id||null,step:{rfq:'rfq',quote:'quote',revision:'revision',reply:'response'}[target.type]};
  delete next.revisionEditingKey;
  if(context.quote)next=bindRevisionDraft(next);
  return {state:next};
}

export function historyModel(state){
  const {rfqs,quotes,revisions,replies}=arrays(state);
  const entry=(type,record)=>{
    const target={type,id:record.id,...(type==='quote'?{version:record.version}:{})},context=resolveRecord(state,target);
    return {record,target,error:context.error||null,current:type==='rfq'?state.activeRfqId===record.id:type==='quote'?state.activeQuoteId===record.id&&state.activeQuoteVersion===record.version:type==='revision'?state.activeRevisionId===record.id:false};
  };
  const requestEntry=record=>{
    const result=entry('revision',record),linkedReplies=replies.filter(r=>r.revisionId===record.id).map(r=>entry('reply',r));
    return {...result,replies:linkedReplies,replyStatus:!linkedReplies.length?'No simulated reply':linkedReplies.some(r=>r.error)?'Reply link needs review':'Simulated reply available'};
  };
  const requests=revisions.map(requestEntry);
  const groups=rfqs.slice().reverse().map(rfq=>({...entry('rfq',rfq),quotes:quotes.filter(q=>q.rfqId===rfq.id).slice().sort((a,b)=>b.version-a.version||a.id.localeCompare(b.id)).map(q=>({...entry('quote',q),requests:requests.filter(r=>r.record.quoteId===q.id&&r.record.quoteVersion===q.version&&r.record.rfqId===rfq.id)}))}));
  const orphaned=[
    ...quotes.filter(q=>!rfqs.some(r=>r.id===q.rfqId)).map(q=>entry('quote',q)),
    ...requests.filter(r=>!quotes.some(q=>q.id===r.record.quoteId&&q.version===r.record.quoteVersion&&q.rfqId===r.record.rfqId)||!rfqs.some(f=>f.id===r.record.rfqId)),
    ...replies.filter(r=>!revisions.some(rev=>rev.id===r.revisionId&&rfqs.some(f=>f.id===rev.rfqId)&&quotes.some(q=>q.id===rev.quoteId&&q.version===rev.quoteVersion&&q.rfqId===rev.rfqId))).map(r=>entry('reply',r))
  ];
  return {groups,pending:requests.filter(r=>!r.error&&!r.replies.length),orphaned,counts:{rfqs:rfqs.length,quotes:quotes.length,revisions:revisions.length,replies:replies.length}};
}
