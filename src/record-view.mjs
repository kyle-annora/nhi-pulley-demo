import {product} from './domain.mjs';
import {inquiryDocument} from './rfq-adapter.mjs';
import {commercialContext} from './commercial-adapter.mjs';
import {recordReviewItems} from './review-items.mjs';

const paramsObject=params=>params instanceof URLSearchParams?Object.fromEntries(params):params||{};
const versionNumber=value=>/^\d+$/.test(String(value??''))&&Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
const unique=(items,predicate)=>{const matches=(items||[]).filter(predicate);return matches.length===1?matches[0]:null;};

// Reading a supporting document has its own URL. It does not select a commercial
// version or replace the case's active draft, quote, request or follow-up state.
export function parseWorkspaceRoute(hash=''){
  const route=String(hash).replace(/^#/,'');
  const separator=route.indexOf('?');
  return {step:separator<0?route:route.slice(0,separator),params:Object.fromEntries(new URLSearchParams(separator<0?'':route.slice(separator+1)))};
}

export function recordHref(source,record,section='questions',extra={}){
  const params=new URLSearchParams({source});
  if(source==='draft'){
    if(record?.product?.id)params.set('product',record.product.id);
  }else{
    if(record?.id!=null)params.set('id',String(record.id));
    if(record?.version!=null)params.set('version',String(record.version));
  }
  params.set('section',section);
  params.set('from',extra.from||({draft:'review',rfq:'rfq',quote:'quote'}[source]||'quote'));
  for(const [key,value] of Object.entries(extra)){
    if(!['source','product','id','version','section','from'].includes(key)&&value!=null)params.set(key,String(value));
  }
  return `#record?${params}`;
}

export function resolveRecordView(state,input={}){
  const params=paramsObject(input),source=params.source;
  const fail=error=>({record:null,source:source||null,items:[],rfq:null,latestQuote:null,error});
  if(!['draft','rfq','quote'].includes(source))return fail('Choose a working inquiry, saved RFQ or exact quote version.');
  if(source==='draft'){
    if(!product(state.selected)||!state.draft)return fail('The working inquiry is unavailable.');
    if(params.product&&params.product!==state.selected)return fail('The working product has changed. Return to the current inquiry before opening its details.');
    if(params.id!=null||params.version!=null)return fail('A working inquiry does not have a saved record identity.');
    const record=inquiryDocument(state);
    return structuredClone({record,source,items:recordReviewItems(record,{includeCommercial:false}),rfq:null,latestQuote:null,error:null});
  }

  const version=versionNumber(params.version);
  if(typeof params.id!=='string'||!params.id||version===null)return fail('Open an exact saved record ID and version.');
  const record=source==='rfq'?unique(state.rfqs,r=>r.id===params.id):unique(state.quotes,q=>q.id===params.id&&q.version===version);
  if(!record||record.version!==version)return fail('This exact saved record is missing or its identity is not unique.');
  const rfq=source==='rfq'?record:unique(state.rfqs,r=>r.id===record.rfqId);
  if(!rfq||!rfq.requirements||!product(rfq.product?.id)||!state.caseId||rfq.caseId!==state.caseId)return fail('The saved inquiry is incomplete or belongs to another case.');
  if(!record.requirements||record.caseId!==state.caseId||record.product?.id!==rfq.product.id||(source==='quote'&&record.rfqVersion!==rfq.version))return fail('The saved document and inquiry references do not match.');
  if(params.product&&params.product!==record.product.id)return fail('The saved product does not match this document link.');
  const context=commercialContext(state,{rfqId:rfq.id});
  if(context.error)return fail(context.error);
  const reply=source==='quote'&&record.responseId?unique(state.replies,r=>r.id===record.responseId):null;
  const revision=source==='quote'&&record.revisionId?unique(state.revisions,r=>r.id===record.revisionId):null;
  const items=recordReviewItems(record,{includeCommercial:source==='quote',reply,revision});
  return structuredClone({record,source,items,rfq,latestQuote:context.latestQuote,error:null});
}
