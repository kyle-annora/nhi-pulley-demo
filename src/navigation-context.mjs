import {parseWorkspaceRoute,resolveRecordView} from './record-view.mjs';
import {commercialContext,sellerEntryState} from './commercial-adapter.mjs';
import {openHistoryRecord} from './history-adapter.mjs';

const workSteps=new Set(['quote','rfq','revision','response','next','seller','history']);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const unique=(list,fn)=>{const matches=(list||[]).filter(fn);return matches.length===1?matches[0]:null;};
const address=(step,params={})=>{const query=new URLSearchParams(Object.entries(params).filter(([,v])=>v!=null&&v!=='').map(([k,v])=>[k,String(v)]));return `#${step}${query.size?`?${query}`:''}`;};
const parsed=route=>typeof route==='string'?parseWorkspaceRoute(route):route||{};

// A URL identifies the case being read, independently of the last active editor.
// Only applyWorkspaceRoute selects editable commercial context; reading documents
// and reference pages must never select a historical quotation for later actions.
export function navigationContext(state,route={step:state.step,params:{}}){
  const {step,params={}}=parsed(route);
  const fail=error=>({step,error,rfq:null,quote:null,latestQuote:null,isDraft:false,source:null,hrefs:{product:'#explore',history:'#history'}});
  let rfq=null,quote=null,revision=null,reply=null,nextStep=null,source='draft';
  const isDraft=['select','explore','configure','review'].includes(step)||(step==='record'&&params.source==='draft');
  if(step==='record'||step==='quote-document'){
    const view=resolveRecordView(state,step==='quote-document'?{...params,source:'quote'}:params);
    if(view.error)return fail(view.error);
    source=view.source;rfq=view.rfq;quote=source==='quote'?view.record:null;
  }else{
    const rfqId=own(params,'rfq')?params.rfq:state.activeRfqId;
    if(rfqId){
      rfq=unique(state.rfqs,r=>r.id===rfqId&&r.caseId===state.caseId);
      if(!rfq)return fail('This saved inquiry is unavailable. Open an existing record from saved records.');
    }else if(own(params,'rfq'))return fail('This link is missing its saved inquiry identity.');
    if(step==='rfq'&&own(params,'version')&&String(rfq?.version)!==String(params.version))return fail('This exact RFQ version is unavailable.');
    const commercial=rfq?commercialContext(state,{rfqId:rfq.id}):null;
    if(commercial?.error)return fail(commercial.error);
    const active=unique(state.quotes,q=>q.id===state.activeQuoteId&&q.version===state.activeQuoteVersion&&q.rfqId===rfq?.id);
    quote=step==='quote'?commercial?.latestQuote:active||commercial?.latestQuote||null;
    if(own(params,'quote')){
      quote=unique(state.quotes,q=>q.id===params.quote&&String(q.version)===String(params.version)&&q.rfqId===rfq?.id);
      if(!quote)return fail('This exact quotation is unavailable for the inquiry in this link.');
    }
    const implicitRevision=unique(state.revisions,r=>r.id===state.activeRevisionId&&r.rfqId===rfq?.id&&(step==='response'||(r.quoteId===quote?.id&&r.quoteVersion===quote?.version)));
    const requestId=own(params,'request')?params.request:step==='seller'?state.sellerRevisionId:step==='revision'||step==='response'?implicitRevision?.id:null;
    if(requestId){
      revision=unique(state.revisions,r=>r.id===requestId&&r.rfqId===rfq?.id);
      if(!revision&&own(params,'request'))return fail('This change request does not belong to the linked inquiry.');
      if(revision){
        const base=unique(state.quotes,q=>q.id===revision.quoteId&&q.version===revision.quoteVersion&&q.rfqId===rfq.id);
        if(!base||(own(params,'quote')&&(base.id!==quote?.id||base.version!==quote?.version)))return fail('This change request and exact quote version do not match.');
        quote=base;
      }
    }
    if(step==='response'){
      reply=own(params,'reply')?unique(state.replies,r=>r.id===params.reply):unique(state.replies,r=>r.revisionId===revision?.id);
      if(!reply)return fail('This saved reply is unavailable. Open it from its change request.');
      const opened=openHistoryRecord(state,{type:'reply',id:reply.id});
      if(opened.error)return fail(opened.error);
      if(rfq&&reply.rfqId!==rfq.id)return fail('This reply does not belong to the linked inquiry.');
      if(own(params,'quote')&&(reply.quoteId!==quote?.id||reply.quoteVersion!==quote?.version))return fail('This reply does not match the exact quote version in this link.');
      if(own(params,'request')&&reply.revisionId!==revision?.id)return fail('This reply does not match the change request in this link.');
      rfq=unique(state.rfqs,r=>r.id===reply.rfqId);
      revision=unique(state.revisions,r=>r.id===reply.revisionId);
      quote=unique(state.quotes,q=>q.id===reply.quoteId&&q.version===reply.quoteVersion);
    }
    if(step==='next'){
      nextStep=own(params,'plan')?unique(state.commercial?.nextSteps,r=>r.id===params.plan):unique(state.commercial?.nextSteps,r=>r.quoteId===quote?.id&&r.quoteVersion===quote?.version&&r.rfqId===rfq?.id);
      if(own(params,'plan')&&!nextStep)return fail('This saved review plan is unavailable.');
      if(nextStep&&(nextStep.rfqId!==rfq?.id||nextStep.quoteId!==quote?.id||nextStep.quoteVersion!==quote?.version))return fail('This review plan does not match the linked inquiry and quote.');
    }
    if(quote){const valid=openHistoryRecord(state,{type:'quote',id:quote.id,version:quote.version});if(valid.error)return fail(valid.error);}
    source=isDraft?'draft':quote&&step!=='rfq'?'quote':'rfq';
  }
  const latest=rfq?commercialContext(state,{rfqId:rfq.id}):null;
  if(latest?.error)return fail(latest.error);
  const latestQuote=latest?.latestQuote||null;
  const referenceHref=source==='quote'&&quote?address('quote-document',{source:'quote',id:quote.id,version:quote.version,view:'reference'}):source==='rfq'&&rfq?address('rfq',{rfq:rfq.id,version:rfq.version,view:'reference'}):address(step==='configure'?'configure':'review',{view:'reference'});
  const productId=isDraft?state.selected:(quote||rfq)?.product?.id||state.selected;
  const hrefs={
    product:'#explore',
    inquiry:rfq?address('rfq',{rfq:rfq.id,version:rfq.version}):'#configure',
    work:rfq?address('quote',{rfq:rfq.id}):'#review',
    quote:(quote||latestQuote)?address('quote-document',{source:'quote',id:(quote||latestQuote).id,version:(quote||latestQuote).version}):null,
    history:address('history',rfq?{rfq:rfq.id}:{}),
    // Compatibility helpers now reveal context inside its own document.
    technical:referenceHref,
    files:source==='quote'&&quote?address('quote-document',{source:'quote',id:quote.id,version:quote.version,view:'attachments'}):referenceHref
  };
  return {step,rfq,quote,latestQuote,revision,reply,nextStep,source,isDraft,productId,hrefs,error:null};
}

export function canonicalWorkspaceRoute(state,route){
  const p=parsed(route),context=navigationContext(state,p);
  if(context.error)return {error:context.error,context,step:p.step,route:address(p.step,p.params)};
  // Retired reference pages remain valid bookmarks, but no longer create a
  // separate reading destination. Resolve their exact source before redirecting.
  if(p.step==='record'){
    const detail=p.params.item?{detail:p.params.item}:{};
    const target=context.source==='quote'
      ?address('quote-document',{source:'quote',id:context.quote.id,version:context.quote.version,view:p.params.section==='files'?'attachments':'reference',...detail})
      :context.source==='rfq'
        ?address('rfq',{rfq:context.rfq.id,version:context.rfq.version,view:'reference',...detail})
        :address('review',{view:'reference',...detail});
    return canonicalWorkspaceRoute(state,target);
  }
  if(!workSteps.has(p.step))return {...p,context,route:address(p.step,p.params)};
  const {rfq,quote,revision,reply,nextStep}=context,params={...p.params};
  if(rfq)params.rfq=rfq.id;
  if(p.step==='rfq'&&rfq)params.version=rfq.version;
  if(['revision','response','next'].includes(p.step)&&quote){params.quote=quote.id;params.version=quote.version;}
  if(['revision','seller'].includes(p.step)&&revision)params.request=revision.id;
  if(p.step==='response'&&reply)params.reply=reply.id;
  if(p.step==='next'&&nextStep)params.plan=nextStep.id;
  return {step:p.step,params,context,route:address(p.step,params)};
}

export function applyWorkspaceRoute(state,route){
  const resolved=canonicalWorkspaceRoute(state,route);
  if(resolved.error)return {state,...resolved};
  const {step,context:c}=resolved;let next=state,result;
  const sameQuote=c.quote&&state.activeRfqId===c.rfq?.id&&state.activeQuoteId===c.quote.id&&state.activeQuoteVersion===c.quote.version;
  if(step==='quote'&&c.latestQuote){if(!sameQuote)result=openHistoryRecord(state,{type:'quote',id:c.latestQuote.id,version:c.latestQuote.version});}
  else if(step==='history'&&c.rfq&&state.activeRfqId!==c.rfq.id)result=openHistoryRecord(state,c.latestQuote?{type:'quote',id:c.latestQuote.id,version:c.latestQuote.version}:{type:'rfq',id:c.rfq.id});
  else if(step==='rfq'&&c.rfq&&state.activeRfqId!==c.rfq.id)result=openHistoryRecord(state,{type:'rfq',id:c.rfq.id});
  else if(step==='revision'&&c.revision){if(!sameQuote||state.activeRevisionId!==c.revision.id)result=openHistoryRecord(state,{type:'revision',id:c.revision.id});}
  else if(['revision','next'].includes(step)&&c.quote&&!sameQuote)result=openHistoryRecord(state,{type:'quote',id:c.quote.id,version:c.quote.version});
  else if(step==='response'&&c.reply){if(!sameQuote||state.activeRevisionId!==c.revision.id)result=openHistoryRecord(state,{type:'reply',id:c.reply.id});}
  else if(step==='seller'&&c.rfq&&(state.activeRfqId!==c.rfq.id||state.sellerRevisionId!==(c.revision?.id||null)))result=sellerEntryState({...state,activeRfqId:c.rfq.id},c.revision?.id||null);
  if(result?.error)return {state,...resolved,error:result.error};
  if(result)next=result.state;
  return {...resolved,state:{...next,step}};
}
