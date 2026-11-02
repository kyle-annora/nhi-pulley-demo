import {commercialContext} from './commercial-adapter.mjs';

// Buyer-facing guidance is a projection of saved facts. A commercial response
// and an unanswered engineering question are distinct waits; neither assigns
// new work to the customer or changes the saved quotation.
export function quoteFollowup(state,q){
  const context=commercialContext(state,{rfqId:q?.rfqId});
  const latest=context.latestQuote||null;
  const archived=Boolean(q&&latest&&(latest.id!==q.id||latest.version!==q.version));
  const pending=archived?[]:context.pendingRevisions||[];
  const request=(state.commercial?.nextSteps||[]).find(r=>r.rfqId===q?.rfqId&&r.quoteId===q?.id&&r.quoteVersion===q?.version)||null;
  const ack=request?(state.commercial?.acknowledgements||[]).find(a=>a.requestId===request.id)||null:null;
  const waitingForReply=pending.some(r=>!(state.replies||[]).some(reply=>reply.revisionId===r.id&&reply.quoteId===r.quoteId&&reply.quoteVersion===r.quoteVersion&&reply.rfqId===r.rfqId));
  const waiting=!context.error&&!archived&&Boolean(pending.length||request||ack);
  let status='Proposal ready for your review';
  let next='Review the proposal, request engineering review of the open questions, or ask for a change to these terms.';
  let actionLabel='Request engineering review';
  let customerGuidance='';

  if(context.error){
    status='The saved context needs attention';
    next=context.error;
    actionLabel='Review saved records';
  }else if(archived){
    status=`Earlier version · latest is v${latest.version}`;
    next='This saved version is unchanged. Open the latest proposal to follow the current request.';
    actionLabel=`Open latest quote v${latest.version}`;
  }else if(pending.length){
    status=waitingForReply?'Waiting for seller reply':'Waiting for revised proposal';
    next=waitingForReply
      ?`The seller needs to respond to your saved change ${pending.length===1?'request':'requests'}. Quote v${q.version} remains unchanged.`
      :`A simulated reply is recorded. The seller has not issued the revised proposal; quote v${q.version} remains unchanged.`;
    actionLabel='View pending change';
    customerGuidance=waitingForReply
      ?'No action needed from you on this change right now. You can wait for the seller’s reply.'
      :'No action needed from you on this change right now. You can wait for the seller’s revised proposal.';
  }else if(ack){
    status='Awaiting engineering findings';
    next='The seller acknowledged the review plan. Engineering findings and application fit remain unconfirmed.';
    actionLabel='View acknowledged review plan';
    customerGuidance='No action needed from you on this review plan right now. Wait for the engineering findings or a specific request for more information.';
  }else if(request){
    status='Waiting for seller acknowledgement';
    next='The seller needs to acknowledge your saved engineering-review plan. Technical findings are still open.';
    actionLabel='View review request';
    customerGuidance='No action needed from you on this review plan right now. You can wait for the seller’s acknowledgement.';
  }

  const commercialChange=pending.some(r=>(r.changes||[]).some(change=>['quantity','timing','finish'].includes(change.field)));
  const technicalLabel=commercialChange
    ?'Separate technical question · Engineering review open'
    :'Technical question · Engineering review open';
  return structuredClone({...context,latest,archived,pending,request,ack,status,next,actionLabel,waiting,customerGuidance,technicalLabel});
}
