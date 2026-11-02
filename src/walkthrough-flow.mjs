import {commercialContext} from './commercial-adapter.mjs';
import {recordReviewItems} from './review-items.mjs';

export const WALKTHROUGH_CHAPTERS=['Understand the pulley','Build the inquiry','Resolve & move forward'];
export const MOUNTING_QUESTION='Please confirm mounting offsets and spacers for our compact mower deck. Which mounting dimensions do you need from us?';

// Derive guidance from saved facts. Browsing a chapter never creates a record.
export function walkthroughFlow(state){
  const context=commercialContext(state),rfq=context.rfq,q=context.latestQuote;
  const input=state.draft.explorerRequirements?.find(r=>r.productId==='F-4412'&&r.feature==='mount'&&r.note);
  if(!rfq)return input?{chapter:2,beat:'inquiry',title:'The 3D question is now part of the inquiry.',note:'Review the 200-piece request, then explicitly save the RFQ.',input}:{chapter:1,beat:'inspect',title:'See the difference. Ask the right question.',note:'Inspect the running surface, flange and mounting area; then save one mounting question.'};
  const retained=rfq.requirements.explorerRequirements?.find(r=>r.feature==='mount'&&r.note);
  if(!q)return {chapter:2,beat:'seller',title:'Give the seller the same product context.',note:'Prepare, review and issue the example v1. The original mounting question stays attached.',rfq,input:retained};
  if(context.pendingRevisions?.length)return {chapter:3,beat:'reply',title:'The change has an owner: the seller.',note:'Review the saved request and issue a revised example proposal. The existing quote stays fixed.',rfq,q,input:retained,revision:context.pendingRevisions[0]};
  if(q.version===1)return {chapter:3,beat:'change',title:'Ask for 250 pieces and a five-week window.',note:'Create a linked change request. Keep the mounting question open for engineering.',rfq,q,input:retained};
  const request=(state.commercial?.nextSteps||[]).find(r=>r.quoteId===q.id&&r.quoteVersion===q.version);
  const ack=request&&(state.commercial?.acknowledgements||[]).find(a=>a.requestId===request.id);
  const reply=state.replies.find(r=>r.id===q.responseId),revision=state.revisions.find(r=>r.id===q.revisionId);
  const item=recordReviewItems(q,{reply,revision}).find(r=>r.source?.requirementId===retained?.id);
  const quoteInput=q.requirements.explorerRequirements?.find(r=>r.id===retained?.id);
  const continuous=!!retained&&!!quoteInput&&quoteInput.note===retained.note&&quoteInput.confirmedAt===retained.confirmedAt;
  return {chapter:3,beat:ack?'complete':request?'acknowledge':'next',title:ack?'One question. One traceable review plan.':'The proposal changed. The question stayed connected.',note:ack?'The seller acknowledged the plan. Engineering still needs to answer the mounting question.':request?'The buyer requested engineering review. Continue as the seller to acknowledge who does what.':'Compare v1 and v2, then request engineering review of the retained mounting question.',rfq,q,input:retained,item,continuous,request,ack};
}
